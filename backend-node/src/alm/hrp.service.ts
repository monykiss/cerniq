import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// Hierarchical Risk Parity — Lopez de Prado (2016)
// No matrix inversion needed — numerically stable for any n

export interface HRPResult {
  weights: number[];
  assetNames: string[];
  portfolioVol: number | null;
  diversificationRatio: number | null;
  clusterOrder: number[];
  dendrogramLevels: Array<{ left: number; right: number; distance: number }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class HRPService {
  private readonly logger = new Logger(HRPService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeHRP(institutionId: string): Promise<HRPResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId, category: 'asset' },
    });

    const bySub = new Map<
      string,
      { balance: number; rate: number; vol: number }
    >();
    for (const item of items) {
      if (!bySub.has(item.subcategory))
        bySub.set(item.subcategory, { balance: 0, rate: 0, vol: 0 });
      const e = bySub.get(item.subcategory)!;
      e.balance += Number(item.balance);
      e.rate += item.rate * item.balance;
    }

    const assetNames = Array.from(bySub.keys());
    const n = assetNames.length;
    // D1: HRP needs ≥2 asset classes to cluster. Refuse rather than fabricate
    // a 6-asset demo allocation for an institution with insufficient data.
    if (n < 2) return this.dataUnavailableResult(n);

    // Volatilities
    const vols = assetNames.map((name) => {
      const sub = name.toLowerCase();
      if (sub.includes('cash')) return 0.01;
      if (sub.includes('securities')) return 0.04;
      if (sub.includes('mortgage')) return 0.06;
      if (sub.includes('commercial')) return 0.08;
      if (sub.includes('consumer') || sub.includes('auto')) return 0.05;
      return 0.05;
    });

    // Correlation matrix (simplified)
    const rho = 0.3;
    const corrMatrix = vols.map((_, i) =>
      vols.map((_, j) => (i === j ? 1.0 : rho)),
    );
    const covMatrix = vols.map((vi, i) =>
      vols.map((vj, j) => vi * vj * corrMatrix[i][j]),
    );

    // Step 1: Distance matrix from correlation
    const dist = corrMatrix.map((row) =>
      row.map((r) => Math.sqrt(0.5 * (1 - r))),
    );

    // Step 2: Hierarchical clustering (single-linkage)
    const { order, dendrogram } = this.hierarchicalClustering(dist, n);

    // Step 3: Recursive bisection
    const weights = new Array(n).fill(1.0);
    this.recursiveBisection(weights, order, covMatrix);

    // Normalize
    const total = weights.reduce((s, w) => s + w, 0) || 1;
    const normWeights = weights.map((w) => w / total);

    // Portfolio metrics
    const portVar = normWeights.reduce(
      (s, wi, i) =>
        s +
        wi * normWeights.reduce((s2, wj, j) => s2 + wj * covMatrix[i][j], 0),
      0,
    );
    const portVol = Math.sqrt(portVar);
    const avgVol = vols.reduce((s, v) => s + v, 0) / n;
    const divRatio = avgVol / (portVol || 1);

    return {
      weights: normWeights.map((w) => +w.toFixed(4)),
      assetNames,
      portfolioVol: +portVol.toFixed(6),
      diversificationRatio: +divRatio.toFixed(4),
      clusterOrder: order,
      dendrogramLevels: dendrogram,
      status: 'ok',
    };
  }

  private hierarchicalClustering(
    dist: number[][],
    n: number,
  ): { order: number[]; dendrogram: HRPResult['dendrogramLevels'] } {
    const active = new Set(Array.from({ length: n }, (_, i) => i));
    const clusters: Map<number, number[]> = new Map();
    for (let i = 0; i < n; i++) clusters.set(i, [i]);
    const dendrogram: HRPResult['dendrogramLevels'] = [];
    let nextId = n;

    while (active.size > 1) {
      // Find closest pair
      let minDist = Infinity,
        bestI = 0,
        bestJ = 0;
      const ids = [...active];
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const ci = clusters.get(ids[a])!;
          const cj = clusters.get(ids[b])!;
          // Single-linkage: min distance between any pair
          let d = Infinity;
          for (const i of ci)
            for (const j of cj) if (dist[i]?.[j] < d) d = dist[i][j];
          if (d < minDist) {
            minDist = d;
            bestI = ids[a];
            bestJ = ids[b];
          }
        }
      }

      // Merge
      const merged = [
        ...(clusters.get(bestI) ?? []),
        ...(clusters.get(bestJ) ?? []),
      ];
      clusters.set(nextId, merged);
      clusters.delete(bestI);
      clusters.delete(bestJ);
      active.delete(bestI);
      active.delete(bestJ);
      active.add(nextId);
      dendrogram.push({
        left: bestI,
        right: bestJ,
        distance: +minDist.toFixed(4),
      });
      nextId++;
    }

    // Seriation order from dendrogram
    const order =
      clusters.get([...active][0]) ?? Array.from({ length: n }, (_, i) => i);
    return { order, dendrogram };
  }

  private recursiveBisection(
    weights: number[],
    items: number[],
    cov: number[][],
  ): void {
    if (items.length <= 1) return;
    const mid = Math.floor(items.length / 2);
    const left = items.slice(0, mid);
    const right = items.slice(mid);

    const varL = this.clusterVariance(left, cov);
    const varR = this.clusterVariance(right, cov);
    const alphaL = 1 - varL / (varL + varR + 1e-10);

    left.forEach((i) => {
      weights[i] *= alphaL;
    });
    right.forEach((i) => {
      weights[i] *= 1 - alphaL;
    });

    this.recursiveBisection(weights, left, cov);
    this.recursiveBisection(weights, right, cov);
  }

  private clusterVariance(items: number[], cov: number[][]): number {
    const n = items.length;
    const w = new Array(n).fill(1 / n);
    return w.reduce(
      (s, wi, i) =>
        s +
        wi *
          w.reduce(
            (s2, wj, j) => s2 + wj * (cov[items[i]]?.[items[j]] ?? 0),
            0,
          ),
      0,
    );
  }

  // D1 honest shell. Replaces the former getDemoResult() that fabricated a
  // 6-asset hierarchical allocation for an institution with <2 asset classes.
  private dataUnavailableResult(assetCount: number): HRPResult {
    const action =
      assetCount === 0
        ? 'Cargue los activos del balance para construir el árbol de riesgo jerárquico.'
        : 'La paridad de riesgo jerárquica requiere al menos 2 clases de activos; cargue activos adicionales.';
    return {
      weights: [],
      assetNames: [],
      portfolioVol: null,
      diversificationRatio: null,
      clusterOrder: [],
      dendrogramLevels: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('hrp.assets', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action,
          context: { service: 'hrp', assetCount },
        }),
      ],
    };
  }
}
