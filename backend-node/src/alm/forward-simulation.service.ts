import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── Types ───────────────────────────────────────────────────
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): the multi-quarter
// NII/EVE/LCR/NSFR projection is computed from the institution's real balance
// sheet. An institution with no balance-sheet data returns an HONEST
// data_unavailable shell with a CRITICAL gap — NEVER a fabricated demo curve.
// (Formerly returned a hardcoded $41.2M base-NII-Y3 demo projection.)

export interface ForwardSimConfig {
  institutionId: string;
  horizon?: number; // years (default 3)
  growthAssumptions?: Record<string, number>; // subcategory → YoY %
  prepaymentAssumptions?: Record<string, number>; // loanType → annual CPR
  ratePaths?: string[]; // which paths to run
}

export interface ForwardQuarter {
  quarter: string;
  ratePath: string;
  projectedNII: number;
  projectedEVE: number;
  projectedLCR: number;
  projectedNSFR: number;
  projectedNWR: number;
  totalAssets: number;
  totalLiabilities: number;
}

export interface ForwardSimResult {
  config: {
    horizon: number;
    growthAssumptions: Record<string, number>;
    ratePaths: string[];
  };
  quarters: ForwardQuarter[];
  // Nullable per D1: with no balance sheet there is nothing to project, so the
  // engine returns `null` + a gap rather than a fabricated demo summary. `null`
  // is structurally distinct from a real `0` an examiner could act on.
  summary: {
    baseNIIYear1: number | null;
    baseNIIYear3: number | null;
    up200NIIYear3: number | null;
    down100NIIYear3: number | null;
    worstCaseNWR: number | null;
    worstCaseLCR: number | null;
  };
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

const DEFAULT_GROWTH: Record<string, number> = {
  consumer_loans: 0.04,
  auto_loans: 0.03,
  residential_mortgage: 0.05,
  commercial_re: 0.06,
  securities: 0.02,
  demand_deposits: 0.03,
  savings: 0.03,
  time_deposits: 0.04,
  borrowings: 0.02,
};

const DEFAULT_PREPAY: Record<string, number> = {
  residential_mortgage: 0.08,
  auto_loans: 0.15,
  consumer_loans: 0.2,
  commercial_re: 0.05,
};

const RATE_PATHS: Record<string, number> = {
  base: 0,
  up200: 200,
  down100: -100,
};

@Injectable()
export class ForwardSimulationService {
  private readonly logger = new Logger(ForwardSimulationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runForwardSimulation(
    config: ForwardSimConfig,
  ): Promise<ForwardSimResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId: config.institutionId },
      });

      const horizon = config.horizon ?? 3;
      const growth = { ...DEFAULT_GROWTH, ...config.growthAssumptions };
      const prepay = { ...DEFAULT_PREPAY, ...config.prepaymentAssumptions };
      const paths = config.ratePaths ?? ['base', 'up200', 'down100'];

      // D1 (never silent zeros): no balance sheet means there is nothing to
      // project. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded $41.2M getDemoResult() projection.
      if (items.length === 0)
        return this.dataUnavailableResult(horizon, growth, paths);

      const totalQuarters = horizon * 4;
      const quarters: ForwardQuarter[] = [];

      for (const path of paths) {
        const shockBps = RATE_PATHS[path] ?? 0;
        let projectedAssets = [
          ...items.filter((i: any) => i.category === 'asset'),
        ];
        let projectedLiabilities = [
          ...items.filter((i: any) => i.category === 'liability'),
        ];

        for (let q = 1; q <= totalQuarters; q++) {
          const quarterLabel = `Q${((q - 1) % 4) + 1} ${new Date().getFullYear() + Math.ceil(q / 4) - 1}`;
          const quarterlyGrowth = (growthFactor: number) =>
            Math.pow(1 + growthFactor, 1 / 4);

          // Project balances
          let totalAssetBal = 0;
          let assetIncome = 0;
          for (const item of projectedAssets) {
            const sub = item.subcategory.toLowerCase();
            const gf = quarterlyGrowth(growth[sub] ?? 0.03);
            const prepayFactor = 1 - (prepay[sub] ?? 0) / 4;
            const balance = item.balance * gf * prepayFactor;
            const rate =
              item.rate +
              (shockBps / 10000) *
                (item.rateType === 'variable' ? 1.0 : q <= 4 ? 0 : 0.3);
            totalAssetBal += balance;
            assetIncome += (balance * rate) / 4;
            item.balance = balance;
          }

          let totalLiabBal = 0;
          let liabExpense = 0;
          for (const item of projectedLiabilities) {
            const sub = item.subcategory.toLowerCase();
            const gf = quarterlyGrowth(growth[sub] ?? 0.03);
            const beta = item.depositBeta ?? this.getDefaultBeta(sub);
            const balance = item.balance * gf;
            const rate = item.rate + (shockBps / 10000) * beta;
            totalLiabBal += balance;
            liabExpense += (balance * rate) / 4;
            item.balance = balance;
          }

          const nii = assetIncome - liabExpense;
          const equity = totalAssetBal - totalLiabBal;
          const nwr = totalAssetBal > 0 ? (equity / totalAssetBal) * 100 : 0;
          const lcr =
            100 + ((totalAssetBal * 0.15) / (totalLiabBal * 0.08) - 1) * 50; // simplified
          const nsfr = 100 + (equity / (totalAssetBal * 0.65) - 0.04) * 200; // simplified

          quarters.push({
            quarter: quarterLabel,
            ratePath: path,
            projectedNII: Math.round(nii * 100) / 100,
            projectedEVE: Math.round(equity * 100) / 100,
            projectedLCR: Math.min(
              200,
              Math.max(50, Math.round(lcr * 10) / 10),
            ),
            projectedNSFR: Math.min(
              200,
              Math.max(50, Math.round(nsfr * 10) / 10),
            ),
            projectedNWR: Math.round(nwr * 100) / 100,
            totalAssets: Math.round(totalAssetBal * 10) / 10,
            totalLiabilities: Math.round(totalLiabBal * 10) / 10,
          });

          // Reset items for next path
          if (q === totalQuarters) {
            projectedAssets = [
              ...items.filter((i: any) => i.category === 'asset'),
            ];
            projectedLiabilities = [
              ...items.filter((i: any) => i.category === 'liability'),
            ];
          }
        }
      }

      const baseQ = quarters.filter((q) => q.ratePath === 'base');
      const up200Q = quarters.filter((q) => q.ratePath === 'up200');
      const down100Q = quarters.filter((q) => q.ratePath === 'down100');

      return {
        config: { horizon, growthAssumptions: growth, ratePaths: paths },
        quarters,
        summary: {
          baseNIIYear1: baseQ
            .slice(0, 4)
            .reduce((s, q) => s + q.projectedNII, 0),
          baseNIIYear3: baseQ.reduce((s, q) => s + q.projectedNII, 0),
          up200NIIYear3:
            up200Q.length > 0
              ? up200Q.reduce((s, q) => s + q.projectedNII, 0)
              : 0,
          down100NIIYear3:
            down100Q.length > 0
              ? down100Q.reduce((s, q) => s + q.projectedNII, 0)
              : 0,
          worstCaseNWR: Math.min(...quarters.map((q) => q.projectedNWR)),
          worstCaseLCR: Math.min(...quarters.map((q) => q.projectedLCR)),
        },
        status: 'ok',
      };
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  private getDefaultBeta(sub: string): number {
    if (sub.includes('demand') || sub.includes('checking')) return 0.1;
    if (sub.includes('saving') || sub.includes('ahorro')) return 0.4;
    if (sub.includes('time') || sub.includes('cd') || sub.includes('plazo'))
      return 0.8;
    return 0.5;
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication ($12.8M base-NII-Y1 / $41.2M base-NII-Y3 / 6.8% worst-NWR with a
  // fabricated quarterly curve) that read as a real forward projection on every
  // empty institution.
  private dataUnavailableResult(
    horizon: number,
    growth: Record<string, number>,
    paths: string[],
  ): ForwardSimResult {
    return {
      config: { horizon, growthAssumptions: growth, ratePaths: paths },
      quarters: [],
      summary: {
        baseNIIYear1: null,
        baseNIIYear3: null,
        up200NIIYear3: null,
        down100NIIYear3: null,
        worstCaseNWR: null,
        worstCaseLCR: null,
      },
      status: 'data_unavailable',
      gaps: [
        dataGap('forwardSimulation.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación para proyectar NII/EVE/LCR/NSFR a futuro bajo escenarios de tasa. / Load the balance sheet to project forward NII/EVE/LCR/NSFR under rate scenarios.',
          context: { service: 'forward-simulation' },
        }),
      ],
    };
  }
}
