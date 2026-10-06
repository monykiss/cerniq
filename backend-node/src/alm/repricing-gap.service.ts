import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { BalanceSheetItem } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── OCIF CC-2022-03 Repricing Buckets ──────────────────────

const BUCKETS = [
  { label: '0–30 Days', labelEs: '0–30 Días', minDays: 0, maxDays: 30 },
  { label: '31–90 Days', labelEs: '31–90 Días', minDays: 31, maxDays: 90 },
  { label: '91–180 Days', labelEs: '91–180 Días', minDays: 91, maxDays: 180 },
  { label: '181d–1 Year', labelEs: '181d–1 Año', minDays: 181, maxDays: 365 },
  { label: '1–3 Years', labelEs: '1–3 Años', minDays: 366, maxDays: 1095 },
  { label: '3–5 Years', labelEs: '3–5 Años', minDays: 1096, maxDays: 1825 },
  {
    label: 'Over 5 Years',
    labelEs: 'Más de 5 Años',
    minDays: 1826,
    maxDays: 999999,
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface RepricingBucket {
  label: string;
  labelEs: string;
  minDays: number;
  maxDays: number;
  assets: number;
  liabilities: number;
  gap: number;
  cumulativeGap: number;
  gapAsPctAssets: number;
  isPolicyBreach: boolean;
}

export interface RepricingGapResult {
  buckets: RepricingBucket[];
  // Nullable per D1: with no balance sheet there is nothing to bucket, so the
  // engine returns `null` + a gap rather than a fabricated demo book. `null` is
  // structurally distinct from a real `0` an OCIF examiner could act on.
  totalAssets: number | null;
  totalLiabilities: number | null;
  durationGap: number | null;
  analysisDate: string;
  policyLimitPct: number;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class RepricingGapService {
  private readonly logger = new Logger(RepricingGapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRepricingGap(
    institutionId: string,
    policyLimitPct: number = 15,
  ): Promise<RepricingGapResult> {
    try {
      const items: BalanceSheetItem[] =
        await this.prisma.balanceSheetItem.findMany({
          where: { institutionId },
        });

      const assetItems = items.filter((i) => i.category === 'asset');
      const liabilityItems = items.filter((i) => i.category === 'liability');

      // D1 (never silent zeros): no asset/liability rows means there is nothing
      // to bucket. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former $445M/$385M getDemoResult() fabrication, which read as a
      // real, mildly asset-sensitive book on every empty institution.
      if (assetItems.length === 0 && liabilityItems.length === 0) {
        return this.dataUnavailableResult(policyLimitPct);
      }

      const totalAssets = assetItems.reduce((s, i) => s + Number(i.balance), 0);
      const totalLiabilities = liabilityItems.reduce(
        (s, i) => s + Number(i.balance),
        0,
      );

      const assetDuration =
        totalAssets > 0
          ? assetItems.reduce(
              (s, i) => s + Number(i.balance) * Number(i.duration),
              0,
            ) / totalAssets
          : 0;
      const liabDuration =
        totalLiabilities > 0
          ? liabilityItems.reduce(
              (s, i) => s + Number(i.balance) * Number(i.duration),
              0,
            ) / totalLiabilities
          : 0;

      let cumulativeGap = 0;
      const buckets: RepricingBucket[] = BUCKETS.map((bucket) => {
        const inBucket = (i: BalanceSheetItem) => {
          const days = this.getRepricingDays(i);
          return days >= bucket.minDays && days <= bucket.maxDays;
        };

        const assets = assetItems
          .filter(inBucket)
          .reduce((s, i) => s + Number(i.balance), 0);
        const liabilities = liabilityItems
          .filter(inBucket)
          .reduce((s, i) => s + Number(i.balance), 0);

        const gap = assets - liabilities;
        cumulativeGap += gap;
        const gapAsPctAssets = totalAssets > 0 ? (gap / totalAssets) * 100 : 0;

        return {
          ...bucket,
          assets: Math.round(assets * 10) / 10,
          liabilities: Math.round(liabilities * 10) / 10,
          gap: Math.round(gap * 10) / 10,
          cumulativeGap: Math.round(cumulativeGap * 10) / 10,
          gapAsPctAssets: Math.round(gapAsPctAssets * 10) / 10,
          isPolicyBreach: Math.abs(gapAsPctAssets) > policyLimitPct,
        };
      });

      // D1: a one-sided balance sheet (assets loaded but not liabilities, or
      // vice versa) yields a real but INCOMPLETE gap — the missing side reads as
      // 0 across every bucket, overstating the gap. Render the result (the
      // loaded side is real) but DISCLOSE the missing side as a WARNING gap
      // rather than letting the silent zero stand.
      const gaps: DataGap[] = [];
      if (assetItems.length === 0) {
        gaps.push(
          dataGap('repricingGap.assets', 'COSSEC_INPUTS_INSUFFICIENT', {
            severity: 'WARNING',
            action:
              'Cargue los activos del balance — sin el lado de activos la brecha de reprecio sobreestima la sensibilidad de los pasivos. / Load balance-sheet assets; without the asset side the repricing gap overstates liability sensitivity.',
          }),
        );
      }
      if (liabilityItems.length === 0) {
        gaps.push(
          dataGap('repricingGap.liabilities', 'COSSEC_INPUTS_INSUFFICIENT', {
            severity: 'WARNING',
            action:
              'Cargue los pasivos del balance — sin el lado de pasivos la brecha de reprecio sobreestima la sensibilidad de los activos. / Load balance-sheet liabilities; without the liability side the repricing gap overstates asset sensitivity.',
          }),
        );
      }

      return {
        buckets,
        totalAssets: Math.round(totalAssets * 10) / 10,
        totalLiabilities: Math.round(totalLiabilities * 10) / 10,
        durationGap: Math.round((assetDuration - liabDuration) * 100) / 100,
        analysisDate: new Date().toISOString(),
        policyLimitPct,
        status: 'ok',
        ...(gaps.length > 0 && { gaps }),
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

  // ─── Private ──────────────────────────────────────────────

  private getRepricingDays(item: BalanceSheetItem): number {
    // Variable-rate instruments reprice at their repricing frequency
    if (item.rateType === 'variable') {
      // If repriceDate is set, use days until that date
      if (item.repriceDate) {
        const days = Math.ceil(
          (new Date(item.repriceDate).getTime() - Date.now()) / 86400000,
        );
        return Math.max(0, days);
      }
      // Default: demand deposits = 1 day, other variable = 90 days
      const sub = (item.subcategory || '').toLowerCase();
      if (sub.includes('demand') || sub.includes('checking')) return 1;
      return 90;
    }

    // Fixed-rate instruments reprice at maturity
    if (item.maturityDate) {
      const days = Math.ceil(
        (new Date(item.maturityDate).getTime() - Date.now()) / 86400000,
      );
      return Math.max(0, days);
    }

    // Use duration as proxy
    return Math.round(Number(item.duration) * 365);
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication ($445M assets / $385M liabilities / 2.1yr duration gap) that
  // read as a real, mildly asset-sensitive book on every empty institution.
  private dataUnavailableResult(policyLimitPct: number): RepricingGapResult {
    return {
      buckets: [],
      totalAssets: null,
      totalLiabilities: null,
      durationGap: null,
      analysisDate: new Date().toISOString(),
      policyLimitPct,
      status: 'data_unavailable',
      gaps: [
        dataGap('repricingGap.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación (activos y pasivos) para calcular la brecha de reprecio (repricing gap, OCIF CC-2022-03). / Load the balance sheet (assets and liabilities) to compute the repricing gap (OCIF CC-2022-03).',
          context: { service: 'repricing-gap' },
        }),
      ],
    };
  }
}
