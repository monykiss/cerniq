import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// JP Morgan CreditMetrics (1997) — Portfolio Credit Risk via Migration Matrix
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): portfolio VaR/ES is
// computed from the institution's real loan segments via Monte Carlo. An
// institution with no loan-segment data returns an HONEST data_unavailable shell
// with a CRITICAL gap — NEVER a fabricated demo VaR. (Formerly returned a
// hardcoded $18.5M VaR / $24.2M ES demo.)

const TRANSITION_MATRIX: Record<string, Record<string, number>> = {
  AAA: { AAA: 0.9081, AA: 0.0833, A: 0.0068, BBB: 0.0006, BB: 0.0012, D: 0 },
  AA: { AAA: 0.007, AA: 0.9065, A: 0.0779, BBB: 0.0064, BB: 0.0006, D: 0 },
  A: { AAA: 0.0009, AA: 0.0227, A: 0.9105, BBB: 0.0552, BB: 0.0074, D: 0.0006 },
  BBB: {
    AAA: 0.0002,
    AA: 0.0033,
    A: 0.0595,
    BBB: 0.8693,
    BB: 0.053,
    D: 0.0018,
  },
  BB: {
    AAA: 0.0003,
    AA: 0.0014,
    A: 0.0067,
    BBB: 0.0773,
    BB: 0.8053,
    D: 0.0106,
  },
  B: { AAA: 0.0001, AA: 0.0011, A: 0.0024, BBB: 0.0043, BB: 0.0648, D: 0.052 },
  CCC: { AAA: 0.0022, AA: 0, A: 0.0022, BBB: 0.013, BB: 0.0238, D: 0.2061 },
};

const RECOVERY_RATES: Record<string, number> = {
  senior_secured: 0.53,
  senior_unsecured: 0.51,
  subordinated: 0.32,
  unsecured: 0.4,
};

export interface CreditMetricsResult {
  // Nullable per D1: with no loan segments there is nothing to simulate, so the
  // engine returns `null` + a gap rather than a fabricated demo VaR. `null` is
  // structurally distinct from a real `0` an examiner could act on.
  portfolioVaR99: number | null;
  portfolioES99: number | null;
  expectedLoss: number | null;
  unexpectedLoss: number | null;
  economicCapital: number | null;
  migrationMatrix: typeof TRANSITION_MATRIX;
  paths: number;
  perSegmentContribution: Array<{
    name: string;
    marginalVaR: number;
    pctOfTotal: number;
  }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class CreditMetricsService {
  private readonly logger = new Logger(CreditMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computePortfolioVaR(
    institutionId: string,
    paths: number = 10000,
    rho: number = 0.15,
  ): Promise<CreditMetricsResult> {
    try {
      const segments = await this.prisma.loanSegment.findMany({
        where: { institutionId },
      });
      // D1 (never silent zeros): no loan segments means there is nothing to
      // simulate. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded $18.5M getDemoResult() fabrication.
      if (segments.length === 0) return this.dataUnavailableResult(paths);

      const rng = this.seededRNG(42);
      const portfolioPnL: number[] = [];

      for (let p = 0; p < paths; p++) {
        const Z_market = this.normalRandom(rng);
        let portfolioLoss = 0;

        for (const seg of segments) {
          const Z_idio = this.normalRandom(rng);
          const Z_i = Math.sqrt(rho) * Z_market + Math.sqrt(1 - rho) * Z_idio;

          const currentRating = 'BBB'; // default for cooperativa loans
          const transitions =
            TRANSITION_MATRIX[currentRating] ?? TRANSITION_MATRIX.BBB;
          const newRating = this.drawRating(Z_i, transitions);

          if (newRating === 'D') {
            const lgd = 1 - RECOVERY_RATES.unsecured;
            portfolioLoss += seg.balance * lgd;
          } else if (
            this.ratingOrder(newRating) > this.ratingOrder(currentRating)
          ) {
            // Downgrade: spread widening loss
            const spreadChange =
              (this.ratingOrder(newRating) - this.ratingOrder(currentRating)) *
              0.005;
            portfolioLoss +=
              seg.balance * spreadChange * (seg.weightedAvgMaturity ?? 3);
          }
        }
        portfolioPnL.push(-portfolioLoss);
      }

      portfolioPnL.sort((a, b) => a - b);
      const var99Idx = Math.floor(paths * 0.01);
      const var99 = -portfolioPnL[var99Idx];
      const es99 =
        -portfolioPnL.slice(0, var99Idx).reduce((s, v) => s + v, 0) /
        Math.max(var99Idx, 1);
      const el = -portfolioPnL.reduce((s, v) => s + v, 0) / paths;
      const ul = var99 - el;

      return {
        portfolioVaR99: +var99.toFixed(2),
        portfolioES99: +es99.toFixed(2),
        expectedLoss: +el.toFixed(2),
        unexpectedLoss: +ul.toFixed(2),
        economicCapital: +(ul * 1.06).toFixed(2),
        migrationMatrix: TRANSITION_MATRIX,
        paths,
        perSegmentContribution: segments.map((s: any) => ({
          name: s.segmentName,
          marginalVaR: +(s.balance * 0.02).toFixed(2),
          pctOfTotal: +(
            (s.balance /
              segments.reduce(
                (sum: number, seg: any) => sum + Number(seg.balance),
                0,
              )) *
            100
          ).toFixed(1),
        })),
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

  private drawRating(Z: number, transitions: Record<string, number>): string {
    const ratings = Object.keys(transitions);
    let cumProb = 0;
    for (const rating of ratings) {
      cumProb += transitions[rating];
      const threshold = this.normInv(cumProb);
      if (Z <= threshold) return rating;
    }
    return ratings[ratings.length - 1];
  }

  private ratingOrder(r: string): number {
    return { AAA: 0, AA: 1, A: 2, BBB: 3, BB: 4, B: 5, CCC: 6, D: 7 }[r] ?? 3;
  }

  private normInv(p: number): number {
    if (p <= 0.0001) return -3.7;
    if (p >= 0.9999) return 3.7;
    const a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];
    const b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    const q = p - 0.5,
      r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
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

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication ($18.5M VaR / $24.2M ES / $13.5M economic capital with three
  // demo segments) that read as a real portfolio credit-risk position on every
  // empty institution.
  private dataUnavailableResult(paths: number): CreditMetricsResult {
    return {
      portfolioVaR99: null,
      portfolioES99: null,
      expectedLoss: null,
      unexpectedLoss: null,
      economicCapital: null,
      migrationMatrix: TRANSITION_MATRIX,
      paths,
      perSegmentContribution: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('creditMetrics.loanSegments', 'NO_LOAN_SEGMENTS', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos (con saldo y vencimiento promedio ponderado) para simular el VaR de crédito del portafolio (CreditMetrics). / Load loan segments (with balance and weighted-average maturity) to simulate portfolio credit VaR (CreditMetrics).',
          context: { service: 'credit-metrics' },
        }),
      ],
    };
  }
}
