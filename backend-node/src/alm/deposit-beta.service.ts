import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface DepositBetaConfig {
  subcategory: string;
  currentBeta: number;
  suggestedBeta: number;
  source: string; // heuristic | calibrated | manual
}

export interface DepositBetaImpact {
  baseNII: number;
  adjustedNII: number;
  niiDelta: number;
  niiDeltaPct: number;
  betaConfigs: DepositBetaConfig[];
}

const DEFAULT_BETAS: Record<string, number> = {
  demand_deposits: 0.1,
  savings: 0.4,
  money_market: 0.5,
  time_deposits: 0.8,
  cds: 0.85,
  borrowings: 1.0,
  fhlb: 1.0,
};

@Injectable()
export class DepositBetaService {
  private readonly logger = new Logger(DepositBetaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDepositBetas(institutionId: string): Promise<DepositBetaConfig[]> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId, category: 'liability' },
    });

    const seen = new Map<string, { beta: number | null; balance: number }>();

    for (const item of items) {
      const sub = item.subcategory.toLowerCase();
      if (!seen.has(sub)) {
        // D1/Decimal: seed with Number()-coerced values. `balance`/`depositBeta`
        // are Prisma Decimal objects; a Decimal seed would make the later
        // `existing.balance += Number(...)` STRING-CONCATENATE on iteration 2,
        // and `beta` flows out as `currentBeta` (used downstream as a number).
        seen.set(sub, {
          beta: item.depositBeta === null ? null : Number(item.depositBeta),
          balance: Number(item.balance),
        });
      } else {
        const existing = seen.get(sub)!;
        existing.balance += Number(item.balance);
        if (item.depositBeta !== null) existing.beta = Number(item.depositBeta);
      }
    }

    return Array.from(seen.entries()).map(([subcategory, { beta }]) => ({
      subcategory,
      currentBeta: beta ?? this.getDefaultBeta(subcategory),
      suggestedBeta: this.getDefaultBeta(subcategory),
      source: beta !== null ? 'manual' : 'heuristic',
    }));
  }

  async updateDepositBetas(
    institutionId: string,
    betas: Array<{ subcategory: string; beta: number }>,
  ): Promise<{ updated: number }> {
    let count = 0;
    for (const { subcategory, beta } of betas) {
      const result = await this.prisma.balanceSheetItem.updateMany({
        where: { institutionId, subcategory, category: 'liability' },
        data: { depositBeta: Math.max(0, Math.min(1, beta)) },
      });
      count += result.count;
    }
    return { updated: count };
  }

  async calculateBetaImpact(
    institutionId: string,
    shockBps: number = 100,
  ): Promise<DepositBetaImpact> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const betas = await this.getDepositBetas(institutionId);

    let baseNII = 0;
    let adjustedNII = 0;

    for (const item of items) {
      const isAsset = item.category === 'asset';
      const beta = isAsset
        ? 1.0
        : (item.depositBeta ?? this.getDefaultBeta(item.subcategory));
      const rateChange = (shockBps / 10000) * beta;

      const baseIncome = item.balance * item.rate;
      const shockedIncome = item.balance * (item.rate + rateChange);

      if (isAsset) {
        baseNII += baseIncome;
        adjustedNII += shockedIncome;
      } else {
        baseNII -= baseIncome;
        adjustedNII -= shockedIncome;
      }
    }

    return {
      baseNII,
      adjustedNII,
      niiDelta: adjustedNII - baseNII,
      niiDeltaPct:
        baseNII !== 0 ? ((adjustedNII - baseNII) / Math.abs(baseNII)) * 100 : 0,
      betaConfigs: betas,
    };
  }

  // ─── OLS Regression Calibration ────────────────────────────

  calibrateBeta(marketRates: number[], depositRates: number[]): number {
    if (marketRates.length < 3 || marketRates.length !== depositRates.length) {
      return 0.5; // insufficient data
    }

    const dMarket = marketRates.slice(1).map((r, i) => r - marketRates[i]);
    const dDeposit = depositRates.slice(1).map((r, i) => r - depositRates[i]);

    const sumXY = dMarket.reduce((s, x, i) => s + x * dDeposit[i], 0);
    const sumXX = dMarket.reduce((s, x) => s + x * x, 0);

    if (sumXX === 0) return 0.5;
    return Math.max(0, Math.min(1, sumXY / sumXX));
  }

  private getDefaultBeta(subcategory: string): number {
    const sub = subcategory.toLowerCase();
    for (const [key, beta] of Object.entries(DEFAULT_BETAS)) {
      if (sub.includes(key) || sub.includes(key.replace('_', ''))) return beta;
    }
    if (sub.includes('demand') || sub.includes('checking')) return 0.1;
    if (sub.includes('saving') || sub.includes('ahorro')) return 0.4;
    if (sub.includes('cd') || sub.includes('plazo') || sub.includes('time'))
      return 0.8;
    return 0.6;
  }
}
