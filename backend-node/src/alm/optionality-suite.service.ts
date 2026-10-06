import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KeyRateDurationService } from './key-rate-duration.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): portfolio optionality
// (option-adjusted duration/convexity) is computed from the institution's real
// balance sheet. An institution with no balance-sheet data returns an HONEST
// data_unavailable shell with a CRITICAL gap — NEVER a fabricated demo. (Formerly
// returned a hardcoded 4.2yr duration / -0.8 convexity demo.)

export interface OptionAdjustedMetrics {
  instrumentName: string;
  category: string;
  balance: number;
  modifiedDuration: number;
  effectiveDuration: number;
  effectiveConvexity: number;
  isNegativelyConvex: boolean;
  optionType: 'none' | 'prepayable' | 'callable' | 'step_up' | 'indexed';
}

export interface PortfolioOptionalityResult {
  instruments: OptionAdjustedMetrics[];
  // Nullable per D1: with no balance sheet there is nothing to measure, so the
  // engine returns `null` + a gap rather than a fabricated demo. `null` is
  // structurally distinct from a real `0` an examiner could act on.
  portfolioModDuration: number | null;
  portfolioEffDuration: number | null;
  portfolioConvexity: number | null;
  durationGap: number | null;
  negConvexityBalance: number | null;
  negConvexityPct: number | null;
  keyRiskTenor: string | null;
  durationMismatchHeatmap: Array<{
    bucket: string;
    assetDuration: number;
    liabDuration: number;
    mismatch: number;
  }>;
  convexityContributors: Array<{
    name: string;
    balance: number;
    convexity: number;
    contribution: number;
  }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

const MATURITY_BUCKETS = ['0-1Y', '1-3Y', '3-5Y', '5-10Y', '10Y+'];

@Injectable()
export class OptionalitySuiteService {
  private readonly logger = new Logger(OptionalitySuiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly krd: KeyRateDurationService,
  ) {}

  async analyzePortfolio(
    institutionId: string,
  ): Promise<PortfolioOptionalityResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });
      // D1 (never silent zeros): no balance sheet means there is nothing to
      // measure. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded 4.2yr-duration getDemoResult() fabrication.
      if (items.length === 0) return this.dataUnavailableResult();

      const instruments: OptionAdjustedMetrics[] = items.map((item: any) => {
        const optionType = this.classifyOptionType(item);
        const modDur = item.duration / (1 + item.rate);
        // Effective duration: shorter for callable/prepayable instruments
        const effDur = optionType !== 'none' ? modDur * 0.75 : modDur; // prepayment shortens effective
        const convexity =
          optionType === 'prepayable' || optionType === 'callable'
            ? (-(item.duration * (item.duration + 1)) /
                Math.pow(1 + item.rate, 2)) *
              0.3 // negative convexity
            : (item.duration * (item.duration + 1)) /
              Math.pow(1 + item.rate, 2);

        return {
          instrumentName: item.name,
          category: item.category,
          balance: item.balance,
          modifiedDuration: +modDur.toFixed(2),
          effectiveDuration: +effDur.toFixed(2),
          effectiveConvexity: +convexity.toFixed(2),
          isNegativelyConvex: convexity < 0,
          optionType,
        };
      });

      const assets = instruments.filter((i) => i.category === 'asset');
      const liabilities = instruments.filter((i) => i.category === 'liability');
      const totalA = assets.reduce((s, i) => s + Number(i.balance), 0);
      const totalL = liabilities.reduce((s, i) => s + Number(i.balance), 0);

      const portModDur =
        totalA > 0
          ? assets.reduce((s, i) => s + i.modifiedDuration * i.balance, 0) /
            totalA
          : 0;
      const portEffDur =
        totalA > 0
          ? assets.reduce((s, i) => s + i.effectiveDuration * i.balance, 0) /
            totalA
          : 0;
      const portConv =
        totalA > 0
          ? assets.reduce((s, i) => s + i.effectiveConvexity * i.balance, 0) /
            totalA
          : 0;
      const liabEffDur =
        totalL > 0
          ? liabilities.reduce(
              (s, i) => s + i.effectiveDuration * i.balance,
              0,
            ) / totalL
          : 0;

      const negConvItems = instruments.filter(
        (i) => i.isNegativelyConvex && i.category === 'asset',
      );
      const negConvBal = negConvItems.reduce(
        (s, i) => s + Number(i.balance),
        0,
      );

      // Duration mismatch heatmap by maturity bucket
      const heatmap = MATURITY_BUCKETS.map((bucket) => {
        const [min, max] = this.parseBucket(bucket);
        const aDur =
          assets
            .filter(
              (i) => i.effectiveDuration >= min && i.effectiveDuration < max,
            )
            .reduce((s, i) => s + i.effectiveDuration * i.balance, 0) /
          (totalA || 1);
        const lDur =
          liabilities
            .filter(
              (i) => i.effectiveDuration >= min && i.effectiveDuration < max,
            )
            .reduce((s, i) => s + i.effectiveDuration * i.balance, 0) /
          (totalL || 1);
        return {
          bucket,
          assetDuration: +aDur.toFixed(2),
          liabDuration: +lDur.toFixed(2),
          mismatch: +(aDur - lDur).toFixed(2),
        };
      });

      // Top convexity contributors (most negative)
      const convContrib = instruments
        .filter((i) => i.category === 'asset')
        .map((i) => ({
          name: i.instrumentName,
          balance: i.balance,
          convexity: i.effectiveConvexity,
          contribution: i.effectiveConvexity * i.balance,
        }))
        .sort((a, b) => a.contribution - b.contribution)
        .slice(0, 5);

      return {
        instruments,
        portfolioModDuration: +portModDur.toFixed(2),
        portfolioEffDuration: +portEffDur.toFixed(2),
        portfolioConvexity: +portConv.toFixed(2),
        durationGap: +(
          portEffDur -
          liabEffDur * (totalL / (totalA || 1))
        ).toFixed(2),
        negConvexityBalance: +negConvBal.toFixed(1),
        negConvexityPct:
          totalA > 0 ? +((negConvBal / totalA) * 100).toFixed(1) : 0,
        keyRiskTenor: '5Y',
        durationMismatchHeatmap: heatmap,
        convexityContributors: convContrib.map((c) => ({
          ...c,
          contribution: +c.contribution.toFixed(1),
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

  private classifyOptionType(item: any): OptionAdjustedMetrics['optionType'] {
    const sub = (item.subcategory ?? '').toLowerCase();
    if (sub.includes('mortgage') || sub.includes('residential'))
      return 'prepayable';
    if (sub.includes('mbs') || sub.includes('callable')) return 'callable';
    if (item.rateType === 'variable') return 'indexed';
    return 'none';
  }

  private parseBucket(bucket: string): [number, number] {
    if (bucket === '0-1Y') return [0, 1];
    if (bucket === '1-3Y') return [1, 3];
    if (bucket === '3-5Y') return [3, 5];
    if (bucket === '5-10Y') return [5, 10];
    return [10, 100];
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication (4.2yr mod-duration / -0.8 convexity / 29.2% neg-convex with
  // demo MBS contributors) that read as a real optionality position on every
  // empty institution.
  private dataUnavailableResult(): PortfolioOptionalityResult {
    return {
      instruments: [],
      portfolioModDuration: null,
      portfolioEffDuration: null,
      portfolioConvexity: null,
      durationGap: null,
      negConvexityBalance: null,
      negConvexityPct: null,
      keyRiskTenor: null,
      durationMismatchHeatmap: [],
      convexityContributors: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('optionalitySuite.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación para analizar la opcionalidad del portafolio (duración y convexidad ajustadas por opciones). / Load the balance sheet to analyze portfolio optionality (option-adjusted duration and convexity).',
          context: { service: 'optionality-suite' },
        }),
      ],
    };
  }
}
