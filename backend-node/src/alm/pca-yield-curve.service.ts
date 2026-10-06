import { Injectable, Logger } from '@nestjs/common';
import { DataGap, dataGap } from './reports/data-gap';

// PCA Yield Curve — 3-Factor Decomposition (Level, Slope, Curvature)
// Decomposes yield curve movements into orthogonal risk factors
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): PCA needs at least
// 10 yield-change observations for the covariance/eigen decomposition to be
// rank-stable. With fewer it returns an HONEST data_unavailable shell with a
// WARNING gap — NEVER the former hardcoded Level/Slope/Curvature demo (89.2 /
// 7.8 / 2.1 explained-variance). (NOTE: the pca-factors controller endpoint
// formerly fed SYNTHETIC yield changes generated from a hardcoded base curve;
// that fabrication has been removed — until a real YieldCurve history is wired,
// the endpoint reports data_unavailable honestly.)

export interface PCAFactor {
  name: string;
  loadings: number[];
  explainedVariancePct: number;
  eigenvalue: number;
}

export interface PCAResult {
  factors: PCAFactor[];
  // Nullable per D1: with fewer than 10 observations there is nothing to
  // decompose, so the engine returns `[]`/`null` + a gap, never a fabricated
  // 99.1% explained-variance demo.
  totalExplainedPct: number | null;
  tenorLabels: string[];
  dv01Attribution?: { level: number; slope: number; curvature: number };
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class PCAYieldCurveService {
  private readonly logger = new Logger(PCAYieldCurveService.name);

  computePCAFactors(yieldChanges: number[][]): PCAResult {
    // D1 (never silent zeros): PCA is not rank-stable below 10 observations.
    // Return an honest data_unavailable shell with a WARNING gap — NEVER the
    // former hardcoded Level/Slope/Curvature getDemoResult().
    if (yieldChanges.length < 10) return this.dataUnavailableResult();

    const n = yieldChanges.length;
    const m = yieldChanges[0]?.length ?? 10;
    const tenorLabels = [
      '3M',
      '6M',
      '1Y',
      '2Y',
      '3Y',
      '5Y',
      '7Y',
      '10Y',
      '20Y',
      '30Y',
    ].slice(0, m);

    // Demean
    const means = Array(m)
      .fill(0)
      .map((_, j) => yieldChanges.reduce((s, r) => s + (r[j] ?? 0), 0) / n);
    const demeaned = yieldChanges.map((row) => row.map((v, j) => v - means[j]));

    // Covariance matrix
    const cov: number[][] = Array.from({ length: m }, (_, i) =>
      Array.from(
        { length: m },
        (_, j) =>
          demeaned.reduce((s, r) => s + (r[i] ?? 0) * (r[j] ?? 0), 0) / (n - 1),
      ),
    );

    // Power iteration for top 3 eigenvectors
    const totalVar = cov.reduce((s, r, i) => s + r[i], 0);
    const factors: PCAFactor[] = [];
    let deflatedCov = cov.map((r) => [...r]);

    for (let f = 0; f < 3; f++) {
      const [eigvec, eigval] = this.powerIteration(deflatedCov, 200);
      const name = f === 0 ? 'Level' : f === 1 ? 'Slope' : 'Curvature';
      factors.push({
        name,
        loadings: eigvec.map((v) => +v.toFixed(4)),
        explainedVariancePct: +((eigval / totalVar) * 100).toFixed(1),
        eigenvalue: +eigval.toFixed(6),
      });
      // Deflate: remove this factor's contribution
      deflatedCov = deflatedCov.map((row, i) =>
        row.map((v, j) => v - eigval * eigvec[i] * eigvec[j]),
      );
    }

    return {
      factors,
      totalExplainedPct: +factors
        .reduce((s, f) => s + f.explainedVariancePct, 0)
        .toFixed(1),
      tenorLabels,
      status: 'ok',
    };
  }

  // Attribute portfolio DV01 to PCA factors
  attributeDV01(
    portfolioDV01: number[],
    factors: PCAFactor[],
  ): { level: number; slope: number; curvature: number } {
    const project = (loadings: number[]) =>
      loadings.reduce((s, l, i) => s + l * (portfolioDV01[i] ?? 0), 0);
    return {
      level: +project(factors[0]?.loadings ?? []).toFixed(2),
      slope: +project(factors[1]?.loadings ?? []).toFixed(2),
      curvature: +project(factors[2]?.loadings ?? []).toFixed(2),
    };
  }

  // Generate synthetic yield changes from base rates — a TEST/utility helper
  // (honestly named "synthetic"); NOT used as a production data source. The
  // controller no longer feeds these to computePCAFactors (D1: a real YieldCurve
  // history must be sourced before PCA results can be presented as real).
  generateSyntheticChanges(
    baseRates: number[],
    weeks: number = 52,
  ): number[][] {
    const m = baseRates.length;
    const changes: number[][] = [];
    const rng = this.seededRNG(42);

    for (let w = 0; w < weeks; w++) {
      const levelShock = this.normalRandom(rng) * 5; // 5bps std
      const slopeShock = this.normalRandom(rng) * 3;
      const curvShock = this.normalRandom(rng) * 2;

      const row = baseRates.map((_, j) => {
        const tenorFraction = j / (m - 1); // 0 for short end, 1 for long end
        return (
          (levelShock +
            slopeShock * (tenorFraction - 0.5) * 2 +
            curvShock * (4 * tenorFraction * (1 - tenorFraction) - 0.5)) /
          10000
        ); // convert bps to decimal
      });
      changes.push(row);
    }
    return changes;
  }

  private powerIteration(M: number[][], maxIter: number): [number[], number] {
    let v: number[] = M.map((_, i) => (i === 0 ? 1 : 0));
    for (let iter = 0; iter < maxIter; iter++) {
      const Mv = M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
      const norm = Math.sqrt(Mv.reduce((s, x) => s + x * x, 0)) || 1;
      v = Mv.map((x) => x / norm);
    }
    const lambda = v.reduce(
      (s, vi, i) => s + vi * M[i].reduce((ss, a, j) => ss + a * v[j], 0),
      0,
    );
    return [v, lambda];
  }

  private seededRNG(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  private normalRandom(rng: () => number): number {
    const u1 = rng() || 1e-10,
      u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // D1: the honest insufficient-data shell. Replaces the former getDemoResult()
  // (hardcoded Level 89.2% / Slope 7.8% / Curvature 2.1% / 99.1% total) that read
  // as a real PCA decomposition whenever fewer than 10 observations were supplied.
  private dataUnavailableResult(): PCAResult {
    return {
      factors: [],
      totalExplainedPct: null,
      tenorLabels: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('pcaYieldCurve.yieldChanges', 'STRESS_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            'La descomposición PCA requiere al menos 10 observaciones de cambios en la curva. Cargue un historial de curvas de rendimiento más largo. / PCA decomposition requires at least 10 yield-change observations. Load a longer yield-curve history.',
          context: { service: 'pca-yield-curve' },
        }),
      ],
    };
  }
}
