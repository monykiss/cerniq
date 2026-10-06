import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, DataGapReason, dataGap } from './reports/data-gap';

// ─── Types ───────────────────────────────────────────────────

/**
 * `historical` — the historical-simulation method. As of the empirical upgrade
 * (Option A) it is run over REAL day-over-day rate moves pulled from
 * `MarketDataSnapshot`, not a synthetic distribution. When the table lacks a
 * dense enough series the method returns `status:'data_unavailable'` (a `null`
 * VaR) rather than fabricating one — see `computeVaRSuite()` and the
 * STALE_SNAPSHOT gaps. The label `historical` therefore never sits on a
 * synthetic number: it is either genuinely empirical or explicitly unavailable.
 */
export type VaRMethod = 'historical' | 'parametric' | 'montecarlo';

export interface VaRResult {
  method: VaRMethod;
  confidenceLevel: number;
  horizon: number; // days
  /** $ value at risk (positive = loss). `null` when inputs are unavailable. */
  var: number | null;
  /** Conditional VaR (expected shortfall). `null` when unavailable. */
  cvar: number | null;
  /** VaR as % of portfolio. `null` when portfolio value is unavailable or 0. */
  varPct: number | null;
  /** $ portfolio value the VaR was computed against. `null` when unavailable. */
  portfolioValue: number | null;
  status: 'ok' | 'data_unavailable';
}

export interface BacktestResult {
  testDays: number;
  exceptions: number | null; // days where actual loss exceeded VaR
  exceptionRate: number | null;
  expectedExceptions: number | null;
  kupiecLR: number | null; // Kupiec likelihood ratio
  kupiecPValue: number | null;
  trafficLight: 'GREEN' | 'AMBER' | 'RED' | null;
  status: 'ok' | 'data_unavailable';
}

export interface VaRSuite {
  historical: VaRResult;
  parametric: VaRResult;
  montecarlo: VaRResult;
  backtestResult: BacktestResult;
  status: 'ok' | 'data_unavailable';
  /**
   * Disclosure + missing-input manifest (D1 contract). On `data_unavailable`
   * (no usable balance sheet) this carries a CRITICAL gap. On `ok` it may carry
   * WARNING gaps: STALE_SNAPSHOT when empirical market history is missing/too
   * sparse (the historical + Monte Carlo methods and the backtest are then
   * withheld, not fabricated) and INDICATOR_NOT_WIRED on the parametric method
   * while it falls back to a fixed-vol assumption. Empty when every method is
   * empirically grounded.
   */
  gaps?: DataGap[];
}

// ─── Empirical market-history parameters ─────────────────────
// The historical-simulation VaR, the empirical-vol estimate (which feeds the
// parametric + Monte Carlo methods), and the Kupiec backtest are all driven by
// REAL day-over-day rate moves from `MarketDataSnapshot`. These thresholds say
// how much consistent daily history a method needs before it may run; below the
// floor the method is `data_unavailable`, never synthetic.

/**
 * Single-scalar rate drivers, in preference order. We need ONE consistent daily
 * series (not a tenor-segmented curve), so we use scalar drivers. The first one
 * with a dense enough series wins. (`TREASURY_CURVE` is tenor-segmented and is
 * intentionally not used here — a representative-tenor extension is future work.)
 */
const EMPIRICAL_DRIVERS = ['FED_FUNDS', 'SOFR', 'PR_DEPOSIT_INDEX'] as const;

/** Trading-day lookback for the historical-simulation VaR + empirical vol. */
const EMPIRICAL_VAR_WINDOW = 250;
/** Minimum day-over-day changes (≈1 trading year) to run an empirical VaR. */
const EMPIRICAL_VAR_MIN_CHANGES = EMPIRICAL_VAR_WINDOW;
/** Rolling estimation window for the out-of-sample (walk-forward) backtest. */
const BACKTEST_ESTIMATION_WINDOW = 250;
/** Basel traffic-light test window. */
const BACKTEST_TEST_DAYS = 250;
/**
 * Minimum changes for an OUT-OF-SAMPLE Kupiec backtest: a rolling estimation
 * window plus a disjoint test window. A 250-day in-sample backtest (VaR fit on
 * the same days it is tested against) is near-tautologically GREEN and tells a
 * regulator nothing, so below this floor the backtest is withheld.
 */
const EMPIRICAL_BACKTEST_MIN_CHANGES =
  BACKTEST_ESTIMATION_WINDOW + BACKTEST_TEST_DAYS;

/**
 * Fixed daily rate-volatility (bps) used by the parametric (delta-normal) VaR
 * ONLY as a fallback when no empirical vol can be estimated. Its use is always
 * disclosed via an INDICATOR_NOT_WIRED gap.
 */
const FALLBACK_DAILY_RATE_VOL_BPS = 5;

// ─── Reproducible randomness (SR 11-7 model governance) ──────
// Quant outputs MUST be deterministic: the same institution + parameters must
// reproduce byte-identical VaR every run. The only stochastic method is the
// Monte Carlo path simulation, and it uses a seeded xorshift32 + Box-Muller
// stream keyed by the institution id. No `Math.random()`, no `crypto.*` — both
// are non-reproducible and a model-validation red flag.

/** xorshift32 PRNG. Same seed → same [0, 1) sequence. */
function createSeededRNG(seed: number): () => number {
  // Avoid the xorshift32 stuck-at-zero fixed point.
  let state = seed | 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** FNV-1a hash of a string → uint32 seed. Stable across runs, distinct per id. */
function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Box-Muller (polar) standard-normal generator over a seeded uniform RNG. The
 * spare draw lives in a closure (not module state) so each generator instance
 * is independent and reproducible.
 */
function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const cached = spare;
      spare = null;
      return cached;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * rng() - 1;
      v = 2 * rng() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    const z = u * mul;
    return Number.isFinite(z) ? z : 0;
  };
}

/** Sample standard deviation (n−1). Returns 0 for fewer than two points. */
function sampleStd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance =
    xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return Math.sqrt(variance);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** VaR as a percentage of portfolio value, to 2dp. `null` when value <= 0. */
function pctOf(value: number, portfolioValue: number): number | null {
  return portfolioValue > 0
    ? Math.round((value / portfolioValue) * 10000) / 100
    : null;
}

/**
 * Empirical rate history for one driver: the chronological day-over-day moves
 * (in bps) plus provenance. `null` is returned by the loader when no driver has
 * a dense enough series; callers then withhold the empirical methods.
 */
interface EmpiricalHistory {
  driver: string;
  /** Full chronological day-over-day moves in bps (for the walk-forward backtest). */
  changesBps: number[];
  /** Distinct daily-close observations the changes were derived from. */
  observations: number;
  fromDate: string;
  toDate: string;
}

@Injectable()
export class PortfolioVaRService {
  private readonly logger = new Logger(PortfolioVaRService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeVaRSuite(
    institutionId: string,
    confidenceLevel: 0.95 | 0.99 = 0.95,
    horizon: 1 | 10 = 1,
  ): Promise<VaRSuite> {
    // ── Input validation ──
    if (confidenceLevel !== 0.95 && confidenceLevel !== 0.99) {
      throw new Error(
        `Invalid confidence level: ${confidenceLevel}. Must be 0.95 or 0.99.`,
      );
    }
    if (horizon !== 1 && horizon !== 10) {
      throw new Error(`Invalid horizon: ${horizon}. Must be 1 or 10.`);
    }

    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId, category: 'asset' },
    });

    // `balance` is a Prisma Decimal — coerce with Number() before arithmetic.
    // (A raw `Number.isFinite(decimal)` is always false, which silently zeroed
    // real balances in the previous implementation.)
    const portfolioValue = items.reduce((sum: number, item: any) => {
      const bal = Number(item.balance);
      return sum + (Number.isFinite(bal) ? bal : 0);
    }, 0);

    // ── Honest minimum (D1): never fabricate a portfolio. ──
    // No assets, or no positive total value → render a data_unavailable shell
    // with a CRITICAL gap. NEVER substitute a phantom $445M book.
    if (items.length === 0 || portfolioValue <= 0) {
      const reason: DataGapReason =
        items.length === 0 ? 'EMPTY_BALANCE_SHEET' : 'MISSING_TOTAL_ASSETS';
      this.logger.warn(
        `VaR data_unavailable for institution ${institutionId}: ${reason} ` +
          `(assets=${items.length}, totalValue=${portfolioValue}).`,
      );
      return this.dataUnavailableSuite(
        confidenceLevel,
        horizon,
        reason,
        institutionId,
      );
    }

    const dv01 = this.portfolioDV01(items);
    const empirical = await this.loadEmpiricalHistory();
    const mcSeed = seedFromString(`${institutionId}:montecarlo`);
    const gaps: DataGap[] = [];

    let historical: VaRResult;
    let parametric: VaRResult;
    let montecarlo: VaRResult;
    let backtestResult: BacktestResult;

    if (empirical && empirical.changesBps.length >= EMPIRICAL_VAR_MIN_CHANGES) {
      // ── Empirical path: real day-over-day rate moves drive every method. ──
      const window = empirical.changesBps.slice(-EMPIRICAL_VAR_WINDOW);
      const dailyVolBps = sampleStd(window);

      historical = this.varFromScenarios(
        window,
        dv01,
        portfolioValue,
        confidenceLevel,
        horizon,
        'historical',
      );
      parametric = this.computeParametricVaR(
        items,
        portfolioValue,
        confidenceLevel,
        horizon,
        dailyVolBps,
      );
      montecarlo = this.computeMonteCarloVaR(
        items,
        portfolioValue,
        confidenceLevel,
        horizon,
        mcSeed,
        dailyVolBps,
      );

      this.logger.log(
        `VaR empirical for ${institutionId}: driver=${empirical.driver} ` +
          `obs=${empirical.observations} window=${window.length} ` +
          `dailyVolBps=${dailyVolBps.toFixed(3)}.`,
      );

      if (empirical.changesBps.length >= EMPIRICAL_BACKTEST_MIN_CHANGES) {
        backtestResult = this.backtestKupiecEmpirical(
          empirical.changesBps,
          dv01,
          confidenceLevel,
        );
      } else {
        // VaR is empirical, but there isn't enough history for an HONEST
        // out-of-sample backtest. Withhold it rather than report an in-sample
        // (tautologically green) traffic light.
        backtestResult = this.unavailableBacktest();
        gaps.push(
          dataGap('backtest', 'STALE_SNAPSHOT', {
            severity: 'WARNING',
            action:
              `Out-of-sample Kupiec backtest needs ≥${EMPIRICAL_BACKTEST_MIN_CHANGES} ` +
              `daily observations (a ${BACKTEST_ESTIMATION_WINDOW}-day rolling ` +
              `estimation window plus a ${BACKTEST_TEST_DAYS}-day test window); ` +
              `${empirical.driver} has ${empirical.observations}. The ` +
              `historical-simulation VaR is empirical; the backtest is withheld ` +
              `rather than computed in-sample.`,
            context: {
              driver: empirical.driver,
              observations: empirical.observations,
              required: EMPIRICAL_BACKTEST_MIN_CHANGES,
            },
          }),
        );
      }
    } else {
      // ── No usable empirical market history. ──
      // Do NOT fabricate a historical simulation or a vol-calibrated Monte
      // Carlo from noise. Those methods are data_unavailable; the parametric
      // method still renders off the REAL portfolio DV01 with a disclosed
      // fixed-vol fallback (the one always-available sensitivity measure).
      const found = empirical?.observations ?? 0;
      historical = this.nullResult('historical', confidenceLevel, horizon);
      montecarlo = this.nullResult('montecarlo', confidenceLevel, horizon);
      parametric = this.computeParametricVaR(
        items,
        portfolioValue,
        confidenceLevel,
        horizon,
        FALLBACK_DAILY_RATE_VOL_BPS,
      );
      backtestResult = this.unavailableBacktest();

      this.logger.warn(
        `VaR empirical market history unavailable for ${institutionId} ` +
          `(found ${found} daily obs, need ≥${EMPIRICAL_VAR_MIN_CHANGES}). ` +
          `Historical + Monte Carlo VaR and the backtest are withheld; ` +
          `parametric falls back to a ${FALLBACK_DAILY_RATE_VOL_BPS}bps vol.`,
      );

      gaps.push(
        dataGap('var.historical', 'STALE_SNAPSHOT', {
          severity: 'WARNING',
          action:
            `Historical-simulation VaR requires a dense daily series of one ` +
            `rate driver (≥${EMPIRICAL_VAR_MIN_CHANGES} day-over-day moves); ` +
            `found ${found}. Withheld — no synthetic fallback. Load ` +
            `MarketDataSnapshot history to enable it.`,
          context: { found, required: EMPIRICAL_VAR_MIN_CHANGES },
        }),
        dataGap('var.montecarlo', 'STALE_SNAPSHOT', {
          severity: 'WARNING',
          action:
            `Monte Carlo VaR requires an empirical daily-volatility estimate ` +
            `from market history; none available (found ${found} daily obs).`,
          context: { found, required: EMPIRICAL_VAR_MIN_CHANGES },
        }),
        dataGap('backtest', 'STALE_SNAPSHOT', {
          severity: 'WARNING',
          action: `Kupiec backtest requires realized market history; none available.`,
          context: { found },
        }),
        dataGap('var.parametric', 'INDICATOR_NOT_WIRED', {
          severity: 'WARNING',
          action:
            `Parametric (delta-normal) VaR uses the real portfolio DV01 with a ` +
            `fixed ${FALLBACK_DAILY_RATE_VOL_BPS}bps daily rate-volatility ` +
            `assumption (market history not wired, so no empirical vol estimate).`,
          context: { dailyRateVolBps: FALLBACK_DAILY_RATE_VOL_BPS },
        }),
      );
    }

    return {
      historical,
      parametric,
      montecarlo,
      backtestResult,
      status: 'ok',
      gaps,
    };
  }

  /** Portfolio DV01 ($ change per 1bp) from real balances × durations. */
  private portfolioDV01(items: any[]): number {
    return items.reduce((sum, item) => {
      const balance = Number(item.balance);
      const duration = Number(item.duration);
      const b = Number.isFinite(balance) ? balance : 0;
      const d = Number.isFinite(duration) ? duration : 1;
      return sum + (b * d) / 10000;
    }, 0);
  }

  // ─── Empirical market-history loader ─────────────────────────

  /**
   * Pull the densest available single-driver daily series from
   * `MarketDataSnapshot` and reduce it to chronological day-over-day moves (bps).
   *
   * `value` is a rate stored as a decimal fraction (4.56% → 0.0456); a 1bp move
   * is 0.0001, so a day-over-day bps change is `(vᵢ − vᵢ₋₁) × 10000`. The feed
   * polls intraday (~5-min), so we first collapse to one close per calendar day
   * before differencing — otherwise near-duplicate intraday rows would swamp the
   * real daily moves.
   *
   * Returns `null` when no driver clears `EMPIRICAL_VAR_MIN_CHANGES`. A DB error
   * (e.g. the table is absent in a stripped schema) is logged and treated as
   * "no history" — the caller then withholds the empirical methods. It is never
   * silently turned into a synthetic VaR.
   */
  private async loadEmpiricalHistory(): Promise<EmpiricalHistory | null> {
    const table = this.prisma.marketDataSnapshot;
    if (!table?.findMany) return null;

    for (const driver of EMPIRICAL_DRIVERS) {
      let rows: Array<{ value: unknown; asOfDate: unknown }>;
      try {
        rows = await table.findMany({
          where: { dataType: driver },
          orderBy: { asOfDate: 'asc' },
          select: { value: true, asOfDate: true },
        });
      } catch (err) {
        this.logger.warn(
          `portfolio_var.empirical_history_query_failed driver=${driver}: ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            `Treating as no history (empirical methods withheld).`,
        );
        return null;
      }

      if (!rows || rows.length < EMPIRICAL_VAR_MIN_CHANGES) continue;

      const daily = this.collapseToDailyCloses(rows);
      if (daily.length < EMPIRICAL_VAR_MIN_CHANGES + 1) continue;

      const changesBps: number[] = [];
      for (let i = 1; i < daily.length; i++) {
        changesBps.push((daily[i].value - daily[i - 1].value) * 10000);
      }
      if (changesBps.length < EMPIRICAL_VAR_MIN_CHANGES) continue;

      return {
        driver,
        changesBps,
        observations: daily.length,
        fromDate: daily[0].date,
        toDate: daily[daily.length - 1].date,
      };
    }

    return null;
  }

  /**
   * Collapse intraday snapshots to one close per UTC calendar day (last write
   * wins, since rows arrive ascending). Corrupt rows (non-finite value or
   * unparseable date) are skipped — never coerced to 0, which would fabricate a
   * spurious rate move.
   */
  private collapseToDailyCloses(
    rows: Array<{ value: unknown; asOfDate: unknown }>,
  ): Array<{ date: string; value: number }> {
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const v = Number(row.value);
      if (!Number.isFinite(v)) continue;
      const d = new Date(row.asOfDate as string | number | Date);
      if (Number.isNaN(d.getTime())) continue;
      byDay.set(d.toISOString().slice(0, 10), v); // YYYY-MM-DD (UTC) close
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, value]) => ({ date, value }));
  }

  // ─── Historical-simulation VaR (empirical scenarios) ─────────

  /**
   * VaR by full revaluation over a set of rate-move scenarios (bps). With the
   * empirical upgrade these scenarios are REAL day-over-day moves, so this is a
   * genuine historical simulation. Full revaluation reduces to −DV01 × shift
   * (parallel-shift assumption); the 1-day distribution is scaled to the horizon
   * by √t. Deterministic (a sort over fixed inputs) — no PRNG needed.
   */
  private varFromScenarios(
    scenariosBps: number[],
    dv01: number,
    portfolioValue: number,
    confidenceLevel: number,
    horizon: number,
    method: VaRMethod,
  ): VaRResult {
    const scaleFactor = Math.sqrt(horizon);
    const scaledPnL = scenariosBps
      .map((bpsShift) => -dv01 * bpsShift * scaleFactor)
      .sort((a, b) => a - b);

    const varIndex = Math.max(
      0,
      Math.floor((1 - confidenceLevel) * scaledPnL.length),
    );
    const var_ = -scaledPnL[varIndex];
    const cvarSlice = scaledPnL.slice(0, Math.max(varIndex, 1));
    const cvar = -cvarSlice.reduce((a, b) => a + b, 0) / cvarSlice.length;

    return {
      method,
      confidenceLevel,
      horizon,
      var: round2(var_),
      cvar: round2(cvar),
      varPct: pctOf(var_, portfolioValue),
      portfolioValue,
      status: 'ok',
    };
  }

  // ─── Parametric (Delta-Normal) VaR ───────────────────────────

  /**
   * Delta-normal VaR over the actual balance-sheet DV01. `dailyVolBps` is the
   * EMPIRICAL daily rate vol when market history is available, and the fixed
   * `FALLBACK_DAILY_RATE_VOL_BPS` assumption (disclosed via a DataGap) otherwise.
   */
  private computeParametricVaR(
    items: any[],
    portfolioValue: number,
    confidenceLevel: number,
    horizon: number,
    dailyVolBps: number,
  ): VaRResult {
    const portfolioDV01 = this.portfolioDV01(items);
    const dailyPortfolioVol = portfolioDV01 * dailyVolBps;
    const z = confidenceLevel === 0.99 ? 2.326 : 1.645;
    const var_ = z * dailyPortfolioVol * Math.sqrt(horizon);

    // CVaR for a normal distribution: sigma * phi(z) / (1 - alpha).
    const phiZ = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
    const cvar =
      (dailyPortfolioVol * Math.sqrt(horizon) * phiZ) / (1 - confidenceLevel);

    return {
      method: 'parametric',
      confidenceLevel,
      horizon,
      var: round2(var_),
      cvar: round2(cvar),
      varPct: pctOf(var_, portfolioValue),
      portfolioValue,
      status: 'ok',
    };
  }

  // ─── Monte Carlo VaR ─────────────────────────────────────────

  /**
   * Monte Carlo VaR: seeded-normal daily shocks calibrated to the EMPIRICAL
   * daily vol, aggregated over the horizon. Only reached when market history is
   * available (so `dailyVolBps` is empirical); reproducible via the seeded PRNG.
   */
  private computeMonteCarloVaR(
    items: any[],
    portfolioValue: number,
    confidenceLevel: number,
    horizon: number,
    seed: number,
    dailyVolBps: number,
  ): VaRResult {
    const paths = 5000;
    const portfolioDV01 = this.portfolioDV01(items);
    const rng = createSeededRNG(seed);
    const gaussian = makeGaussian(rng);
    const pnlVector: number[] = [];

    for (let p = 0; p < paths; p++) {
      // Simulate the rate change over the horizon (sum of daily shocks).
      let totalShock = 0;
      for (let d = 0; d < horizon; d++) {
        totalShock += gaussian() * dailyVolBps;
      }
      const pnl = -portfolioDV01 * totalShock;
      pnlVector.push(Number.isFinite(pnl) ? pnl : 0);
    }

    pnlVector.sort((a, b) => a - b);
    const varIndex = Math.max(0, Math.floor((1 - confidenceLevel) * paths));
    const var_ = -pnlVector[varIndex];
    const cvarSlice = pnlVector.slice(0, Math.max(varIndex, 1));
    const cvar = -cvarSlice.reduce((a, b) => a + b, 0) / cvarSlice.length;

    return {
      method: 'montecarlo',
      confidenceLevel,
      horizon,
      var: round2(var_),
      cvar: round2(cvar),
      varPct: pctOf(var_, portfolioValue),
      portfolioValue,
      status: 'ok',
    };
  }

  // ─── Kupiec Backtest (out-of-sample, walk-forward) ───────────

  /**
   * A GENUINE Kupiec POF test + Basel traffic light. For each of the most-recent
   * `BACKTEST_TEST_DAYS` trading days we estimate the 1-day historical-simulation
   * VaR from the PRIOR `BACKTEST_ESTIMATION_WINDOW` empirical moves and test it
   * against that day's realized move. This is walk-forward (out-of-sample): the
   * VaR never sees the day it is judged on, so the exception count and traffic
   * light reflect real predictive accuracy — not the in-sample tautology of the
   * old synthetic self-consistency check.
   */
  private backtestKupiecEmpirical(
    changesBps: number[],
    dv01: number,
    confidenceLevel: number,
  ): BacktestResult {
    const testDays = BACKTEST_TEST_DAYS;
    const start = changesBps.length - testDays;
    let exceptions = 0;

    for (let t = start; t < changesBps.length; t++) {
      const est = changesBps.slice(t - BACKTEST_ESTIMATION_WINDOW, t);
      const estPnL = est.map((b) => -dv01 * b).sort((a, b) => a - b);
      const vi = Math.max(0, Math.floor((1 - confidenceLevel) * estPnL.length));
      const varThreshold = -estPnL[vi];
      const realized = -dv01 * changesBps[t];
      if (realized < -varThreshold) exceptions++;
    }

    const exceptionRate = exceptions / testDays;
    const expectedExceptions = testDays * (1 - confidenceLevel);

    // Kupiec LR statistic.
    const p = 1 - confidenceLevel;
    const T = testDays;
    const x = exceptions;

    let kupiecLR: number;
    if (x === 0) {
      // No exceptions: LR = -2 * T * ln(1 - p).
      kupiecLR = -2 * (T * Math.log(1 - p));
    } else if (x === T) {
      // Every day an exception.
      kupiecLR = -2 * T * Math.log(p);
    } else {
      kupiecLR =
        -2 * ((T - x) * Math.log(1 - p) + x * Math.log(p)) +
        2 * ((T - x) * Math.log(1 - x / T) + x * Math.log(x / T));
    }
    if (!Number.isFinite(kupiecLR)) kupiecLR = 0;

    // chi-squared(1) critical values: 3.84 (95%), 6.63 (99%).
    const kupiecPValue = kupiecLR > 6.63 ? 0.01 : kupiecLR > 3.84 ? 0.05 : 0.1;

    // Basel traffic light over a 250-day window.
    let trafficLight: NonNullable<BacktestResult['trafficLight']>;
    if (confidenceLevel === 0.99) {
      // Basel standard: green <= 4, amber 5-9, red >= 10.
      if (exceptions <= 4) trafficLight = 'GREEN';
      else if (exceptions <= 9) trafficLight = 'AMBER';
      else trafficLight = 'RED';
    } else {
      // 95%: expected exceptions = 12.5 for 250 days; thresholds scaled.
      if (exceptions <= 17) trafficLight = 'GREEN';
      else if (exceptions <= 25) trafficLight = 'AMBER';
      else trafficLight = 'RED';
    }

    return {
      testDays,
      exceptions,
      exceptionRate: Math.round(exceptionRate * 10000) / 10000,
      expectedExceptions: Math.round(expectedExceptions * 10) / 10,
      kupiecLR: round2(kupiecLR),
      kupiecPValue,
      trafficLight,
      status: 'ok',
    };
  }

  // ─── Honest-minimum helpers ──────────────────────────────────

  private nullResult(
    method: VaRMethod,
    confidenceLevel: number,
    horizon: number,
  ): VaRResult {
    return {
      method,
      confidenceLevel,
      horizon,
      var: null,
      cvar: null,
      varPct: null,
      portfolioValue: null,
      status: 'data_unavailable',
    };
  }

  private unavailableBacktest(): BacktestResult {
    return {
      testDays: BACKTEST_TEST_DAYS,
      exceptions: null,
      exceptionRate: null,
      expectedExceptions: null,
      kupiecLR: null,
      kupiecPValue: null,
      trafficLight: null,
      status: 'data_unavailable',
    };
  }

  private dataUnavailableSuite(
    confidenceLevel: number,
    horizon: number,
    reason: DataGapReason,
    institutionId: string,
  ): VaRSuite {
    const action =
      reason === 'EMPTY_BALANCE_SHEET'
        ? 'Upload the institution’s asset balance sheet (balances + durations) to compute portfolio VaR.'
        : 'Asset balance sheet has no positive total value — verify imported balances before computing VaR.';
    return {
      historical: this.nullResult('historical', confidenceLevel, horizon),
      parametric: this.nullResult('parametric', confidenceLevel, horizon),
      montecarlo: this.nullResult('montecarlo', confidenceLevel, horizon),
      backtestResult: this.unavailableBacktest(),
      status: 'data_unavailable',
      gaps: [
        dataGap('var', reason, {
          severity: 'CRITICAL',
          action,
          context: { institutionId },
        }),
      ],
    };
  }
}
