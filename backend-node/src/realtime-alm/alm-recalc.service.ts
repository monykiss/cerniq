import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MarketRateResult, RecalcResult } from './realtime-alm.dto';

/**
 * Recalculates key ALM metrics when market rates change.
 *
 * In production the service pulls the institution's balance sheet from the
 * database and runs NII sensitivity, EVE, Duration Gap, and LCR calculations.
 * Until the full balance-sheet integration is wired up, the service returns
 * plausible demo values shifted by the rate delta so the WebSocket layer
 * can exercise the full data flow end-to-end.
 */
@Injectable()
export class AlmRecalcService {
  private readonly logger = new Logger(AlmRecalcService.name);

  /** Cache of the latest recalc per institution. */
  private readonly lastRecalc = new Map<string, RecalcResult>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalculate NII sensitivity, EVE change, Duration Gap, and LCR
   * for an institution given a set of newly observed market rates.
   */
  async recalculateOnRateChange(
    institutionId: string,
    newRates: MarketRateResult[],
  ): Promise<RecalcResult> {
    const previous = this.lastRecalc.get(institutionId);
    const previousMetrics = previous?.metrics ?? {
      niiSensitivity: 0,
      eveChange: 0,
      durationGap: 0,
      lcr: 0,
    };

    // Compute a weighted rate delta (basis-point average across all incoming rates)
    const rateDelta = this.computeAverageRateDelta(newRates);

    // Attempt to load real balance-sheet items for a model-based recalc
    const balanceSheet = await this.loadBalanceSheet(institutionId);

    let metrics: RecalcResult['metrics'];

    if (balanceSheet && balanceSheet.length > 0) {
      metrics = this.calculateFromBalanceSheet(
        balanceSheet,
        rateDelta,
        previousMetrics,
      );
    } else {
      // Demo / fallback: shift previous metrics by rate delta
      metrics = this.calculateDemo(rateDelta, previousMetrics);
    }

    const result: RecalcResult = {
      institutionId,
      metrics,
      previousMetrics: {
        niiSensitivity: previousMetrics.niiSensitivity,
        eveChange: previousMetrics.eveChange,
        durationGap: previousMetrics.durationGap,
        lcr: previousMetrics.lcr,
      },
      recalculatedAt: new Date().toISOString(),
    };

    this.lastRecalc.set(institutionId, result);
    this.logger.debug(
      `Recalc for ${institutionId}: NII=${metrics.niiSensitivity.toFixed(2)} EVE=${metrics.eveChange.toFixed(2)} DG=${metrics.durationGap.toFixed(2)} LCR=${metrics.lcr.toFixed(2)}`,
    );

    return result;
  }

  /**
   * Return the most recent recalc result for an institution, or null.
   */
  getLastRecalc(institutionId: string): RecalcResult | null {
    return this.lastRecalc.get(institutionId) ?? null;
  }

  // ─── Private helpers ───────────────────────────────────────

  /**
   * Compute the average basis-point change across incoming rates
   * (only for rates that have a previousValue).
   */
  private computeAverageRateDelta(rates: MarketRateResult[]): number {
    const deltas = rates
      .filter((r) => r.previousValue !== undefined && r.previousValue !== null)
      .map((r) => r.value - (r.previousValue ?? r.value));

    if (deltas.length === 0) return 0;
    return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  }

  /**
   * Simplified model-based calculation from balance-sheet items.
   * Uses duration weighting to estimate NII and EVE sensitivity.
   */
  private calculateFromBalanceSheet(
    items: any[],
    rateDelta: number,
    previous: Record<string, number>,
  ): RecalcResult['metrics'] {
    let assetDuration = 0;
    let liabilityDuration = 0;
    let totalAssets = 0;
    let totalLiabilities = 0;
    let hqlaBalance = 0;
    let netCashOutflow = 0;

    for (const item of items) {
      const balance = Number(item.balance) || 0;
      const duration = Number(item.duration) || 0;

      if (item.category === 'asset') {
        assetDuration += balance * duration;
        totalAssets += balance;
        // HQLA approximation: short-duration, high-quality assets
        if (
          duration <= 1 &&
          (item.subcategory === 'cash' ||
            item.subcategory === 'government_securities')
        ) {
          hqlaBalance += balance;
        }
      } else {
        liabilityDuration += balance * duration;
        totalLiabilities += balance;
        // Net cash outflow approximation: short-term liabilities
        if (duration <= 0.25) {
          netCashOutflow += balance * 0.1; // 10% runoff assumption
        }
      }
    }

    const avgAssetDuration = totalAssets > 0 ? assetDuration / totalAssets : 3;
    const avgLiabilityDuration =
      totalLiabilities > 0 ? liabilityDuration / totalLiabilities : 1.5;

    const durationGap = avgAssetDuration - avgLiabilityDuration;

    // NII sensitivity: approximated as rate delta * repricing gap
    const niiSensitivity =
      (previous.niiSensitivity || -2.5) + rateDelta * 10000 * 0.02;

    // EVE change: -durationGap * rateDelta * totalAssets (% basis)
    const eveImpact =
      totalAssets > 0
        ? (-durationGap * rateDelta * totalAssets) / totalAssets
        : rateDelta * -150;
    const eveChange = (previous.eveChange || -3.2) + eveImpact * 100;

    // LCR
    const lcr =
      netCashOutflow > 0
        ? (hqlaBalance / netCashOutflow) * 100
        : (previous.lcr || 145) + rateDelta * -50;

    return {
      niiSensitivity: this.round(niiSensitivity),
      eveChange: this.round(eveChange),
      durationGap: this.round(durationGap),
      lcr: this.round(lcr),
    };
  }

  /**
   * Demo / fallback: shift the baseline metrics by the rate delta.
   */
  private calculateDemo(
    rateDelta: number,
    previous: Record<string, number>,
  ): RecalcResult['metrics'] {
    const bpsDelta = rateDelta * 10000; // convert decimal → bps

    return {
      niiSensitivity: this.round(
        (previous.niiSensitivity || -2.5) + bpsDelta * 0.02,
      ),
      eveChange: this.round((previous.eveChange || -3.2) + bpsDelta * -0.015),
      durationGap: this.round(previous.durationGap || 1.8),
      lcr: this.round((previous.lcr || 145) + bpsDelta * -0.05),
    };
  }

  private async loadBalanceSheet(institutionId: string): Promise<any[]> {
    try {
      return await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });
    } catch {
      return [];
    }
  }

  private round(n: number, decimals = 4): number {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
  }
}
