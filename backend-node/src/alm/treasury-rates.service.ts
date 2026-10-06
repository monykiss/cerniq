import { Injectable, Logger } from '@nestjs/common';
import { parseFinancialField } from '../common/utils/financial-field';

// ─── FRED Series IDs ────────────────────────────────────────

const FRED_SERIES: Record<string, string> = {
  fedFunds: 'FEDFUNDS',
  sofr: 'SOFR',
  treasury3M: 'DGS3MO',
  treasury1Y: 'DGS1',
  treasury2Y: 'DGS2',
  treasury5Y: 'DGS5',
  treasury10Y: 'DGS10',
  treasury30Y: 'DGS30',
};

export interface TreasuryRateSnapshot {
  capturedAt: string;
  fedFunds: number;
  sofr: number;
  treasury3M: number;
  treasury1Y: number;
  treasury2Y: number;
  treasury5Y: number;
  treasury10Y: number;
  treasury30Y: number;
  prMuniSpread: number | null;
  source: string;
}

export interface RateMoveAlert {
  rate: string;
  previous: number;
  current: number;
  deltaBps: number;
  direction: 'UP' | 'DOWN';
  timestamp: string;
}

@Injectable()
export class TreasuryRatesService {
  private readonly logger = new Logger(TreasuryRatesService.name);
  private cachedSnapshot: TreasuryRateSnapshot | null = null;
  private cacheTimestamp = 0;

  async getLatestSnapshot(): Promise<TreasuryRateSnapshot> {
    // Return cached if < 4 hours old
    if (
      this.cachedSnapshot &&
      Date.now() - this.cacheTimestamp < 4 * 3600 * 1000
    ) {
      return this.cachedSnapshot;
    }

    const fredApiKey = process.env.FRED_API_KEY;
    if (fredApiKey) {
      try {
        const snapshot = await this.fetchFromFRED(fredApiKey);
        this.cachedSnapshot = snapshot;
        this.cacheTimestamp = Date.now();
        return snapshot;
      } catch (err) {
        this.logger.warn(`FRED fetch failed, using approximation: ${err}`);
      }
    }

    const approximation = this.getApproximation();
    this.cachedSnapshot = approximation;
    this.cacheTimestamp = Date.now();
    return approximation;
  }

  async getYieldCurvePoints(): Promise<Array<{ tenor: number; rate: number }>> {
    const s = await this.getLatestSnapshot();
    return [
      { tenor: 0.25, rate: s.treasury3M },
      { tenor: 1, rate: s.treasury1Y },
      { tenor: 2, rate: s.treasury2Y },
      { tenor: 5, rate: s.treasury5Y },
      { tenor: 10, rate: s.treasury10Y },
      { tenor: 30, rate: s.treasury30Y },
    ];
  }

  detectRateMoves(
    previous: TreasuryRateSnapshot,
    current: TreasuryRateSnapshot,
  ): RateMoveAlert[] {
    const alerts: RateMoveAlert[] = [];
    const keys: (keyof TreasuryRateSnapshot)[] = [
      'fedFunds',
      'sofr',
      'treasury2Y',
      'treasury10Y',
    ];

    for (const key of keys) {
      const prev = previous[key] as number;
      const curr = current[key] as number;
      if (typeof prev !== 'number' || typeof curr !== 'number') continue;
      const deltaBps = Math.round((curr - prev) * 10000);
      if (Math.abs(deltaBps) >= 5) {
        alerts.push({
          rate: key,
          previous: prev,
          current: curr,
          deltaBps,
          direction: deltaBps > 0 ? 'UP' : 'DOWN',
          timestamp: current.capturedAt,
        });
      }
    }
    return alerts;
  }

  private async fetchFromFRED(apiKey: string): Promise<TreasuryRateSnapshot> {
    const results: Record<string, number> = {};

    const fetches = Object.entries(FRED_SERIES).map(async ([key, seriesId]) => {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          // D23: same FRED API parse pattern as market-data-feed.
          // Bounded in percent form [-5, 50] to catch Infinity and
          // out-of-band values that would corrupt the rate cache.
          const val = parseFinancialField(data?.observations?.[0]?.value, {
            min: -5,
            max: 50,
          });
          if (val !== null) results[key] = val / 100;
        }
      } catch {
        /* skip */
      }
    });

    await Promise.all(fetches);

    return {
      capturedAt: new Date().toISOString(),
      fedFunds: results.fedFunds ?? 0.0475,
      sofr: results.sofr ?? 0.047,
      treasury3M: results.treasury3M ?? 0.048,
      treasury1Y: results.treasury1Y ?? 0.044,
      treasury2Y: results.treasury2Y ?? 0.042,
      treasury5Y: results.treasury5Y ?? 0.0405,
      treasury10Y: results.treasury10Y ?? 0.042,
      treasury30Y: results.treasury30Y ?? 0.0465,
      prMuniSpread: 0.0185,
      source: 'FRED',
    };
  }

  private getApproximation(): TreasuryRateSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      fedFunds: 0.0475,
      sofr: 0.047,
      treasury3M: 0.048,
      treasury1Y: 0.044,
      treasury2Y: 0.042,
      treasury5Y: 0.0405,
      treasury10Y: 0.042,
      treasury30Y: 0.0465,
      prMuniSpread: 0.0185,
      source: 'approximation',
    };
  }
}
