import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  MarketRateResult,
  MarketDataSnapshot,
  TreasuryCurveResult,
} from './realtime-alm.dto';
import { parseFinancialField } from '../common/utils/financial-field';

// Plausible Treasury/SOFR rate bounds in percent form (pre-/100
// scaling). Covers the 1954 Volcker peak (~20%) through hypothetical
// negative-rate stress scenarios. Rates outside this band from FRED
// indicate a data-feed bug, not a real market move.
const FRED_RATE_PERCENT_MIN = -5;
const FRED_RATE_PERCENT_MAX = 50;

/**
 * FRED API series IDs for ALM-relevant rates.
 * The existing TreasuryRatesService covers a subset; this service targets the
 * full yield curve + SOFR specifically for the real-time ALM dashboard.
 */
const FRED_SERIES: Record<string, string> = {
  SOFR: 'SOFR',
};

const TREASURY_SERIES: Record<number, string> = {
  1: 'DGS1MO',
  3: 'DGS3MO',
  6: 'DGS6MO',
  12: 'DGS1',
  24: 'DGS2',
  36: 'DGS3',
  60: 'DGS5',
  84: 'DGS7',
  120: 'DGS10',
  240: 'DGS20',
  360: 'DGS30',
};

/** Fallback rates used when FRED_API_KEY is absent (demo / local dev). */
const DEMO_RATES: Record<string, number> = {
  SOFR: 0.047,
  UST_1M: 0.0483,
  UST_3M: 0.048,
  UST_6M: 0.0465,
  UST_1Y: 0.044,
  UST_2Y: 0.042,
  UST_3Y: 0.041,
  UST_5Y: 0.0405,
  UST_7Y: 0.041,
  UST_10Y: 0.042,
  UST_20Y: 0.045,
  UST_30Y: 0.0465,
  PR_DEPOSIT_INDEX: 0.032,
};

const DEMO_TREASURY_POINTS = [
  { tenorMonths: 1, rate: 0.0483 },
  { tenorMonths: 3, rate: 0.048 },
  { tenorMonths: 6, rate: 0.0465 },
  { tenorMonths: 12, rate: 0.044 },
  { tenorMonths: 24, rate: 0.042 },
  { tenorMonths: 36, rate: 0.041 },
  { tenorMonths: 60, rate: 0.0405 },
  { tenorMonths: 84, rate: 0.041 },
  { tenorMonths: 120, rate: 0.042 },
  { tenorMonths: 240, rate: 0.045 },
  { tenorMonths: 360, rate: 0.0465 },
];

@Injectable()
export class MarketDataFeedService implements OnModuleDestroy {
  private readonly logger = new Logger(MarketDataFeedService.name);
  private pollingTimer: NodeJS.Timeout | null = null;

  /** In-memory snapshot cache keyed by dataType. */
  private readonly snapshotCache = new Map<string, MarketDataSnapshot>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    this.stopPolling();
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Fetch all data sources and return an array of snapshots.
   * Each snapshot is cached in memory and persisted to the database
   * when a `MarketDataSnapshot` table exists.
   */
  async fetchLatestRates(): Promise<MarketDataSnapshot[]> {
    const results: MarketDataSnapshot[] = [];

    try {
      const sofr = await this.fetchSOFR();
      results.push(this.toSnapshot(sofr));
    } catch (err) {
      this.logger.warn(`SOFR fetch failed: ${err}`);
    }

    try {
      const curve = await this.fetchTreasuryCurve();
      for (const pt of curve.points) {
        const label = this.tenorLabel(pt.tenorMonths);
        results.push(
          this.toSnapshot({
            dataType: label,
            value: pt.rate,
            previousValue: this.snapshotCache.get(label)?.value,
            asOfDate: curve.asOfDate,
            source: 'US_TREASURY',
          }),
        );
      }
    } catch (err) {
      this.logger.warn(`Treasury curve fetch failed: ${err}`);
    }

    // PR deposit rate index — no live API; cached manually
    const prIdx = this.snapshotCache.get('PR_DEPOSIT_INDEX');
    results.push({
      dataType: 'PR_DEPOSIT_INDEX',
      value: prIdx?.value ?? DEMO_RATES.PR_DEPOSIT_INDEX,
      previousValue: prIdx?.previousValue ?? null,
      asOfDate: new Date().toISOString(),
      source: 'COSSEC',
    });

    // Persist to cache
    for (const snap of results) {
      this.snapshotCache.set(snap.dataType, snap);
    }

    // Best-effort persistence (table may not exist yet in early migrations)
    await this.persistSnapshots(results);

    return results;
  }

  /**
   * Fetch the latest SOFR rate from the FRED API.
   * Falls back to a demo value when FRED_API_KEY is not configured.
   */
  async fetchSOFR(): Promise<MarketRateResult> {
    const apiKey = process.env.FRED_API_KEY;
    const previous = this.snapshotCache.get('SOFR')?.value;

    if (!apiKey) {
      this.logger.debug('FRED_API_KEY not set — returning demo SOFR');
      return {
        dataType: 'SOFR',
        value: DEMO_RATES.SOFR,
        previousValue: previous,
        asOfDate: new Date().toISOString(),
        source: 'demo',
      };
    }

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${FRED_SERIES.SOFR}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`FRED API returned ${res.status}`);
    }

    const data = (await res.json()) as {
      observations?: { date: string; value: string }[];
    };
    // D23: FRED returns `obs.value` as a string (often "4.56" or ".")
    // for SOFR. parseFloat(".") = NaN which used to fall back, but
    // parseFloat("1e400") = Infinity which slipped the `isNaN`
    // guard and corrupted the dashboard. Bound-validated parse on
    // the percent form eliminates both.
    const obs = data?.observations?.[0];
    const percent = obs
      ? parseFinancialField(obs.value, {
          min: FRED_RATE_PERCENT_MIN,
          max: FRED_RATE_PERCENT_MAX,
        })
      : null;
    const value = percent === null ? DEMO_RATES.SOFR : percent / 100;

    return {
      dataType: 'SOFR',
      value,
      previousValue: previous,
      asOfDate: obs?.date ?? new Date().toISOString(),
      source: 'FRED',
    };
  }

  /**
   * Fetch the full US Treasury yield curve from the FRED API.
   * Falls back to demo points when FRED_API_KEY is not configured.
   */
  async fetchTreasuryCurve(): Promise<TreasuryCurveResult> {
    const apiKey = process.env.FRED_API_KEY;

    if (!apiKey) {
      this.logger.debug('FRED_API_KEY not set — returning demo Treasury curve');
      return {
        points: DEMO_TREASURY_POINTS,
        asOfDate: new Date().toISOString(),
      };
    }

    const points: { tenorMonths: number; rate: number }[] = [];
    let latestDate = '';

    const fetches = Object.entries(TREASURY_SERIES).map(
      async ([tenorStr, seriesId]) => {
        const tenorMonths = parseInt(tenorStr, 10);
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
          const res = await fetch(url);
          if (!res.ok) return;

          const data = (await res.json()) as {
            observations?: { date: string; value: string }[];
          };
          const obs = data?.observations?.[0];
          if (!obs) return;

          // D23: same validation as SOFR path — reject non-finite and
          // out-of-band values so a FRED oddity doesn't corrupt the
          // yield curve.
          const percent = parseFinancialField(obs.value, {
            min: FRED_RATE_PERCENT_MIN,
            max: FRED_RATE_PERCENT_MAX,
          });
          if (percent === null) return;
          const rate = percent / 100;

          points.push({ tenorMonths, rate });
          if (obs.date > latestDate) latestDate = obs.date;
        } catch {
          /* skip individual tenor failures */
        }
      },
    );

    await Promise.all(fetches);

    // Sort by tenor
    points.sort((a, b) => a.tenorMonths - b.tenorMonths);

    // Fall back to demo if nothing came through
    if (points.length === 0) {
      return {
        points: DEMO_TREASURY_POINTS,
        asOfDate: new Date().toISOString(),
      };
    }

    return {
      points,
      asOfDate: latestDate || new Date().toISOString(),
    };
  }

  /**
   * Return the latest in-memory snapshot for a given data type,
   * or null if no data has been fetched yet.
   */
  getLatestSnapshot(dataType: string): MarketDataSnapshot | null {
    return this.snapshotCache.get(dataType) ?? null;
  }

  /**
   * Return historical rate snapshots within a date range.
   * Reads from the database when the MarketDataSnapshot table exists;
   * otherwise returns in-memory cache entries.
   */
  async getHistoricalRates(
    dataType: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<MarketDataSnapshot[]> {
    try {
      const rows = await (this.prisma as any).marketDataSnapshot?.findMany({
        where: {
          dataType,
          asOfDate: { gte: fromDate.toISOString(), lte: toDate.toISOString() },
        },
        orderBy: { asOfDate: 'asc' },
      });
      if (rows) return rows;
    } catch {
      /* table may not exist */
    }

    // Fallback: return current cache entry if it falls in range
    const cached = this.snapshotCache.get(dataType);
    if (cached) {
      const d = new Date(cached.asOfDate);
      if (d >= fromDate && d <= toDate) return [cached];
    }
    return [];
  }

  /**
   * Start the automatic polling cycle.
   * @param intervalMs polling interval in milliseconds (default 300 000 = 5 min)
   */
  startPolling(intervalMs = 300_000): void {
    if (this.pollingTimer) {
      this.logger.warn('Polling already active — ignoring duplicate start');
      return;
    }

    this.logger.log(`Starting market-data polling every ${intervalMs / 1000}s`);
    this.pollingTimer = setInterval(() => {
      void this.fetchLatestRates().catch((err) =>
        this.logger.error(`Polling cycle failed: ${err}`),
      );
    }, intervalMs);

    if (this.pollingTimer.unref) {
      this.pollingTimer.unref();
    }

    // Immediate first fetch
    void this.fetchLatestRates().catch((err) =>
      this.logger.error(`Initial fetch failed: ${err}`),
    );
  }

  /**
   * Stop the polling cycle.
   */
  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      this.logger.log('Market-data polling stopped');
    }
  }

  // ─── Internals ───────────────────────────────────────────────

  private toSnapshot(rate: MarketRateResult): MarketDataSnapshot {
    return {
      dataType: rate.dataType,
      value: rate.value,
      previousValue: rate.previousValue ?? null,
      asOfDate: rate.asOfDate,
      source: rate.source,
    };
  }

  private tenorLabel(tenorMonths: number): string {
    if (tenorMonths < 12) return `UST_${tenorMonths}M`;
    return `UST_${tenorMonths / 12}Y`;
  }

  private async persistSnapshots(
    snapshots: MarketDataSnapshot[],
  ): Promise<void> {
    try {
      const table = (this.prisma as any).marketDataSnapshot;
      if (!table) return;

      await Promise.all(
        snapshots.map((s) =>
          table.create({
            data: {
              dataType: s.dataType,
              value: s.value,
              previousValue: s.previousValue,
              asOfDate: s.asOfDate,
              source: s.source,
            },
          }),
        ),
      );
    } catch {
      /* table may not exist in current schema — silently skip */
    }
  }
}
