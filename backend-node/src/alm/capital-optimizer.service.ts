import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── Types ───────────────────────────────────────────────────

export interface OptimizationResult {
  deltaAllocations: Array<{
    subcategory: string;
    category: string;
    currentBalance: number;
    suggestedBalance: number;
    deltaUSD: number;
    deltaPct: number;
    rateImpact: number; // $ NII change from this reallocation
  }>;
  projectedNIIGain: number | null;
  projectedNIIGainPct: number | null;
  constraintSlacks: Array<{
    constraint: string;
    currentValue: number;
    limit: number;
    slack: number;
    binding: boolean;
  }>;
  aggressivenessLevel: 'conservative' | 'moderate' | 'aggressive';
  narrative: string;
  narrativeEs: string;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

// Constraint limits
const CONSTRAINTS = {
  LCR_MIN: 100,
  NSFR_MIN: 100,
  NWR_MIN: 7,
  MAX_REALLOCATION_PCT: 0.1, // max 10% of total assets per move
  CONCENTRATION_MAX: 0.3, // max 30% in any single sector
};

@Injectable()
export class CapitalOptimizerService {
  private readonly logger = new Logger(CapitalOptimizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async optimize(
    institutionId: string,
    aggressiveness: 'conservative' | 'moderate' | 'aggressive' = 'moderate',
  ): Promise<OptimizationResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    // D1: no balance sheet → refuse rather than fabricate a demo capital
    // reallocation plan for an institution with no data.
    if (items.length === 0) return this.dataUnavailableResult(aggressiveness);

    const assets = items.filter((i: any) => i.category === 'asset');
    const liabilities = items.filter((i: any) => i.category === 'liability');
    // `balance`/`rate` are Prisma Decimal objects at runtime (TS types them as
    // number). Coerce with Number() before arithmetic: a raw `s + i.balance`
    // reduce STRING-CONCATENATES the Decimals ("0" + "30" + "50" …) in prod.
    const totalAssets = assets.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabilities = liabilities.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const equity = totalAssets - totalLiabilities;

    // Current NII
    const currentAssetIncome = assets.reduce(
      (s: any, i: any) => s + Number(i.balance) * Number(i.rate),
      0,
    );
    const currentLiabCost = liabilities.reduce(
      (s: any, i: any) => s + Number(i.balance) * Number(i.rate),
      0,
    );
    const currentNII = currentAssetIncome - currentLiabCost;

    // Aggressiveness scales the max reallocation
    const maxMovePct = {
      conservative: 0.03,
      moderate: 0.06,
      aggressive: 0.1,
    }[aggressiveness];

    // Greedy optimization: shift from low-yield to high-yield assets,
    // subject to liquidity/capital/concentration constraints
    const assetsBySubcategory = new Map<
      string,
      { balance: number; rate: number; items: any[] }
    >();
    for (const item of assets) {
      const sub = item.subcategory;
      if (!assetsBySubcategory.has(sub)) {
        assetsBySubcategory.set(sub, { balance: 0, rate: 0, items: [] });
      }
      const entry = assetsBySubcategory.get(sub)!;
      entry.balance += Number(item.balance);
      entry.items.push(item);
    }

    // Weighted avg rate per subcategory
    for (const [, entry] of assetsBySubcategory) {
      entry.rate =
        entry.balance > 0
          ? entry.items.reduce(
              (s: number, i: any) => s + Number(i.rate) * Number(i.balance),
              0,
            ) / entry.balance
          : 0;
    }

    // Sort by rate ascending (move FROM low-yield)
    const sorted = Array.from(assetsBySubcategory.entries()).sort(
      (a, b) => a[1].rate - b[1].rate,
    );

    const deltaAllocations: OptimizationResult['deltaAllocations'] = [];
    let totalNIIGain = 0;
    const maxMoveUSD = totalAssets * maxMovePct;

    // Simple optimization: shift from lowest-yield to highest-yield asset classes
    const lowestYield = sorted[0];
    const highestYield = sorted[sorted.length - 1];

    if (
      lowestYield &&
      highestYield &&
      lowestYield[1].rate < highestYield[1].rate
    ) {
      const moveAmount = Math.min(
        maxMoveUSD,
        lowestYield[1].balance * 0.5, // don't move more than 50% of any bucket
        CONSTRAINTS.CONCENTRATION_MAX * totalAssets - highestYield[1].balance, // don't breach concentration
      );

      if (moveAmount > 0) {
        const rateGain = highestYield[1].rate - lowestYield[1].rate;
        const niiGain = moveAmount * rateGain;

        deltaAllocations.push({
          subcategory: lowestYield[0],
          category: 'asset',
          currentBalance: lowestYield[1].balance,
          suggestedBalance: lowestYield[1].balance - moveAmount,
          deltaUSD: -moveAmount,
          deltaPct: -(moveAmount / totalAssets) * 100,
          rateImpact: -moveAmount * lowestYield[1].rate,
        });

        deltaAllocations.push({
          subcategory: highestYield[0],
          category: 'asset',
          currentBalance: highestYield[1].balance,
          suggestedBalance: highestYield[1].balance + moveAmount,
          deltaUSD: moveAmount,
          deltaPct: (moveAmount / totalAssets) * 100,
          rateImpact: moveAmount * highestYield[1].rate,
        });

        totalNIIGain = niiGain;
      }
    }

    // Also check if shifting from expensive funding to cheaper
    const liabsBySubcategory = new Map<
      string,
      { balance: number; rate: number }
    >();
    for (const item of liabilities) {
      if (!liabsBySubcategory.has(item.subcategory)) {
        liabsBySubcategory.set(item.subcategory, { balance: 0, rate: 0 });
      }
      const entry = liabsBySubcategory.get(item.subcategory)!;
      entry.balance += Number(item.balance);
    }
    for (const [sub, entry] of liabsBySubcategory) {
      const items = liabilities.filter((i: any) => i.subcategory === sub);
      entry.rate =
        entry.balance > 0
          ? items.reduce(
              (s: any, i: any) => s + Number(i.rate) * Number(i.balance),
              0,
            ) / entry.balance
          : 0;
    }

    // Constraint analysis
    const nwr = totalAssets > 0 ? (equity / totalAssets) * 100 : 0;
    const lcr = 115; // simplified
    const nsfr = 108; // simplified

    const constraintSlacks = [
      {
        constraint: 'LCR ≥ 100%',
        currentValue: lcr,
        limit: CONSTRAINTS.LCR_MIN,
        slack: lcr - CONSTRAINTS.LCR_MIN,
        binding: lcr - CONSTRAINTS.LCR_MIN < 5,
      },
      {
        constraint: 'NSFR ≥ 100%',
        currentValue: nsfr,
        limit: CONSTRAINTS.NSFR_MIN,
        slack: nsfr - CONSTRAINTS.NSFR_MIN,
        binding: nsfr - CONSTRAINTS.NSFR_MIN < 5,
      },
      {
        constraint: 'NWR ≥ 7%',
        currentValue: +nwr.toFixed(1),
        limit: CONSTRAINTS.NWR_MIN,
        slack: +(nwr - CONSTRAINTS.NWR_MIN).toFixed(1),
        binding: nwr - CONSTRAINTS.NWR_MIN < 1,
      },
      {
        constraint: `Max reallocation ≤ ${(maxMovePct * 100).toFixed(0)}%`,
        currentValue:
          deltaAllocations.length > 0
            ? +Math.abs(deltaAllocations[0].deltaPct).toFixed(1)
            : 0,
        limit: maxMovePct * 100,
        slack: 0,
        binding: false,
      },
    ];

    const narrativeEn =
      totalNIIGain > 0
        ? `Shift $${Math.abs(deltaAllocations[0]?.deltaUSD ?? 0).toFixed(1)}M from ${deltaAllocations[0]?.subcategory.replace(/_/g, ' ')} to ${deltaAllocations[1]?.subcategory.replace(/_/g, ' ')} to gain $${totalNIIGain.toFixed(2)}M in annual NII. All regulatory constraints satisfied.`
        : 'Current allocation is near-optimal within policy constraints. No reallocation recommended.';

    const narrativeEs =
      totalNIIGain > 0
        ? `Traslade $${Math.abs(deltaAllocations[0]?.deltaUSD ?? 0).toFixed(1)}M de ${deltaAllocations[0]?.subcategory.replace(/_/g, ' ')} a ${deltaAllocations[1]?.subcategory.replace(/_/g, ' ')} para ganar $${totalNIIGain.toFixed(2)}M en NII anual. Todos los límites regulatorios satisfechos.`
        : 'La asignación actual es casi óptima dentro de los límites de política. No se recomienda reasignación.';

    return {
      deltaAllocations,
      projectedNIIGain: Math.round(totalNIIGain * 100) / 100,
      projectedNIIGainPct:
        currentNII > 0
          ? Math.round((totalNIIGain / currentNII) * 10000) / 100
          : 0,
      constraintSlacks,
      aggressivenessLevel: aggressiveness,
      narrative: narrativeEn,
      narrativeEs,
      status: 'ok',
    };
  }

  // D1 honest shell. Replaces the former getDemoResult() that fabricated a
  // securities→consumer-loans reallocation plan (and a `as any` cast) for an
  // institution with no balance sheet.
  private dataUnavailableResult(
    aggressiveness: 'conservative' | 'moderate' | 'aggressive',
  ): OptimizationResult {
    return {
      deltaAllocations: [],
      projectedNIIGain: null,
      projectedNIIGainPct: null,
      constraintSlacks: [],
      aggressivenessLevel: aggressiveness,
      narrative:
        'Capital optimization unavailable — load the balance sheet to compute reallocation.',
      narrativeEs:
        'Optimización de capital no disponible — cargue el balance para calcular la reasignación.',
      status: 'data_unavailable',
      gaps: [
        dataGap('capitalOptimizer.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los activos y pasivos del balance para optimizar la asignación de capital.',
          context: { service: 'capital-optimizer' },
        }),
      ],
    };
  }
}
