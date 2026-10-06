import { Injectable, Logger } from '@nestjs/common';

/**
 * Maturity Ladder — Quant Model
 *
 * Builds a maturity gap ladder by bucketing assets and liabilities
 * into standard time buckets and computing the gap and cumulative gap
 * at each tenor.
 *
 * Standard Buckets:
 *   O/N, 1W, 2W, 1M, 2M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, 10Y, >10Y
 *
 * Gap_t = Assets_t - Liabilities_t
 * CumulativeGap_t = Σ_{s≤t} Gap_s
 *
 * Concentration Risk = max bucket balance / total balance
 *   (high concentration in any single bucket indicates rollover risk)
 */

export interface MaturityItem {
  name: string;
  balance: number;
  maturityDate: string;
}

export interface MaturityBucket {
  period: string;
  daysMax: number;
  assetTotal: number;
  liabilityTotal: number;
  gap: number;
  cumulativeGap: number;
}

export interface MaturityLadderResult {
  buckets: MaturityBucket[];
  concentrationRisk: number;
  totalAssets: number;
  totalLiabilities: number;
  netPosition: number;
  largestGapBucket: string;
}

/** Standard time bucket definitions (label -> max days) */
const BUCKET_DEFINITIONS: Array<{ period: string; daysMax: number }> = [
  { period: 'O/N', daysMax: 1 },
  { period: '1W', daysMax: 7 },
  { period: '2W', daysMax: 14 },
  { period: '1M', daysMax: 30 },
  { period: '2M', daysMax: 60 },
  { period: '3M', daysMax: 90 },
  { period: '6M', daysMax: 180 },
  { period: '1Y', daysMax: 365 },
  { period: '2Y', daysMax: 730 },
  { period: '3Y', daysMax: 1095 },
  { period: '5Y', daysMax: 1825 },
  { period: '10Y', daysMax: 3650 },
  { period: '>10Y', daysMax: Infinity },
];

@Injectable()
export class MaturityLadderService {
  private readonly logger = new Logger(MaturityLadderService.name);

  /**
   * Build a maturity ladder from assets and liabilities.
   *
   * @param params.assets - Array of assets with name, balance, maturityDate
   * @param params.liabilities - Array of liabilities with name, balance, maturityDate
   * @param params.asOfDate - Reference date for computing days to maturity (default: now)
   * @returns Bucketed maturity ladder with gaps and concentration risk
   */
  buildMaturityLadder(params: {
    assets: MaturityItem[];
    liabilities: MaturityItem[];
    asOfDate?: string;
  }): MaturityLadderResult {
    const { assets, liabilities } = params;
    const asOf = params.asOfDate ? new Date(params.asOfDate) : new Date();

    this.logger.log(
      `Building maturity ladder: ${assets.length} assets, ${liabilities.length} liabilities`,
    );

    // Initialize buckets
    const buckets: MaturityBucket[] = BUCKET_DEFINITIONS.map((def) => ({
      period: def.period,
      daysMax: def.daysMax,
      assetTotal: 0,
      liabilityTotal: 0,
      gap: 0,
      cumulativeGap: 0,
    }));

    // Assign assets to buckets
    let totalAssets = 0;
    for (const asset of assets) {
      const daysToMaturity = this.daysBetween(
        asOf,
        new Date(asset.maturityDate),
      );
      const bucketIdx = this.findBucket(daysToMaturity);
      buckets[bucketIdx].assetTotal += Number(asset.balance);
      totalAssets += Number(asset.balance);
    }

    // Assign liabilities to buckets
    let totalLiabilities = 0;
    for (const liability of liabilities) {
      const daysToMaturity = this.daysBetween(
        asOf,
        new Date(liability.maturityDate),
      );
      const bucketIdx = this.findBucket(daysToMaturity);
      buckets[bucketIdx].liabilityTotal += Number(liability.balance);
      totalLiabilities += Number(liability.balance);
    }

    // Compute gaps and cumulative gaps
    let cumulativeGap = 0;
    let maxAbsGap = 0;
    let largestGapBucket = '';

    for (const bucket of buckets) {
      bucket.assetTotal = +bucket.assetTotal.toFixed(2);
      bucket.liabilityTotal = +bucket.liabilityTotal.toFixed(2);
      bucket.gap = +(bucket.assetTotal - bucket.liabilityTotal).toFixed(2);
      cumulativeGap += bucket.gap;
      bucket.cumulativeGap = +cumulativeGap.toFixed(2);

      if (Math.abs(bucket.gap) > maxAbsGap) {
        maxAbsGap = Math.abs(bucket.gap);
        largestGapBucket = bucket.period;
      }
    }

    // Concentration risk: max single-bucket balance / total balance
    const totalBalance = totalAssets + totalLiabilities;
    let maxBucketBalance = 0;
    for (const bucket of buckets) {
      const bucketBalance = bucket.assetTotal + bucket.liabilityTotal;
      if (bucketBalance > maxBucketBalance) {
        maxBucketBalance = bucketBalance;
      }
    }
    const concentrationRisk =
      totalBalance > 0 ? +(maxBucketBalance / totalBalance).toFixed(4) : 0;

    return {
      buckets,
      concentrationRisk,
      totalAssets: +totalAssets.toFixed(2),
      totalLiabilities: +totalLiabilities.toFixed(2),
      netPosition: +(totalAssets - totalLiabilities).toFixed(2),
      largestGapBucket,
    };
  }

  /**
   * Compute liquidity gap ratio for each bucket.
   *
   * LiquidityGapRatio = CumulativeGap / TotalAssets
   */
  computeLiquidityGapRatios(params: {
    buckets: MaturityBucket[];
    totalAssets: number;
  }): Array<{ period: string; gapRatio: number; status: string }> {
    const { buckets, totalAssets } = params;

    return buckets.map((b) => {
      const gapRatio = totalAssets > 0 ? b.cumulativeGap / totalAssets : 0;

      let status: string;
      if (gapRatio < -0.1) {
        status = 'Critical';
      } else if (gapRatio < -0.05) {
        status = 'Warning';
      } else if (gapRatio < 0) {
        status = 'Monitor';
      } else {
        status = 'Adequate';
      }

      return {
        period: b.period,
        gapRatio: +gapRatio.toFixed(4),
        status,
      };
    });
  }

  // ─── Private Helpers ──────────────────────────────────────

  private daysBetween(from: Date, to: Date): number {
    const msPerDay = 86_400_000;
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / msPerDay));
  }

  private findBucket(daysToMaturity: number): number {
    for (let i = 0; i < BUCKET_DEFINITIONS.length; i++) {
      if (daysToMaturity <= BUCKET_DEFINITIONS[i].daysMax) {
        return i;
      }
    }
    return BUCKET_DEFINITIONS.length - 1;
  }
}
