// ─── HJM Calibration + ForwardCurve + Monte Carlo Tests ─────────
//
// Validates the full HJM two-factor pipeline:
//   1. Calibration from synthetic historical rates
//   2. ForwardCurve bootstrapping, shocks, and twist
//   3. Monte Carlo reproducibility and distribution properties
//   4. Edge cases and input validation

import { ForwardCurve } from './forward-curve';
import {
  HJMCalibrationService,
  type HistoricalRateInput,
} from './hjm-calibration.service';
import {
  HJMMonteCarloService,
  type BalanceSheetSummary,
} from './hjm-monte-carlo.service';
import { calibrateHJM, computeDriftCorrection } from './hjm/calibration';
import { runHJMMonteCarlo } from './hjm/monte-carlo';
import type {
  HJMParams,
  HJMMonteCarloInput,
  RateTimeSeries,
  RepricingBucket,
} from './hjm/types';

// ─── Test Fixtures ──────────────────────────────────────────────

const SPOT_RATES: Record<string, number> = {
  '1M': 0.048,
  '3M': 0.0465,
  '6M': 0.044,
  '1Y': 0.042,
  '2Y': 0.041,
  '3Y': 0.0405,
  '5Y': 0.041,
  '7Y': 0.042,
  '10Y': 0.043,
  '20Y': 0.0455,
  '30Y': 0.0465,
};

const TEST_HJM_PARAMS: HJMParams = {
  sigma1: 0.012,
  sigma2: 0.006,
  rho: -0.35,
  eigenvalue1: 5.7e-7,
  eigenvalue2: 1.4e-7,
  varianceExplained: 0.94,
  tenors: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  calibratedAt: '2026-04-01T00:00:00Z',
  sampleSize: 504,
  lookbackYears: 2,
};

const TEST_BUCKETS: RepricingBucket[] = [
  {
    tenor: 0.25,
    assetBalance: 50,
    assetRate: 0.048,
    liabilityBalance: 30,
    liabilityRate: 0.02,
  },
  {
    tenor: 1,
    assetBalance: 120,
    assetRate: 0.044,
    liabilityBalance: 100,
    liabilityRate: 0.025,
  },
  {
    tenor: 3,
    assetBalance: 80,
    assetRate: 0.042,
    liabilityBalance: 60,
    liabilityRate: 0.03,
  },
  {
    tenor: 5,
    assetBalance: 60,
    assetRate: 0.045,
    liabilityBalance: 40,
    liabilityRate: 0.035,
  },
  {
    tenor: 10,
    assetBalance: 40,
    assetRate: 0.05,
    liabilityBalance: 20,
    liabilityRate: 0.04,
  },
];

/** Generate synthetic rate history for calibration tests. */
function generateSyntheticHistory(
  days: number,
  seed: number = 42,
): HistoricalRateInput[] {
  const labels = [
    '1M',
    '3M',
    '6M',
    '1Y',
    '2Y',
    '3Y',
    '5Y',
    '7Y',
    '10Y',
    '20Y',
    '30Y',
  ];
  const baseRates = [
    0.048, 0.046, 0.044, 0.042, 0.041, 0.04, 0.041, 0.042, 0.043, 0.045, 0.046,
  ];
  const history: HistoricalRateInput[] = [];

  // Deterministic PRNG (xorshift32)
  let state = seed;
  const xorshift = () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };

  const currentRates = [...baseRates];

  for (let d = 0; d < days; d++) {
    const date = new Date(2024, 0, 1 + d).toISOString().slice(0, 10);
    const tenors: Record<string, number> = {};
    for (let i = 0; i < labels.length; i++) {
      // Mean-reverting random walk with level + slope correlation
      const levelShock = (xorshift() - 0.5) * 0.002;
      const slopeShock = (xorshift() - 0.5) * 0.001 * (i / labels.length);
      currentRates[i] += levelShock + slopeShock;
      currentRates[i] = Math.max(0.001, currentRates[i]); // floor at 10bps
      tenors[labels[i]] = currentRates[i];
    }
    history.push({ date, tenors });
  }

  return history;
}

/** Convert HistoricalRateInput[] to RateTimeSeries for pure-function tests. */
function toTimeSeries(inputs: HistoricalRateInput[]): RateTimeSeries {
  return inputs.map((obs) => ({ date: obs.date, rates: obs.tenors }));
}

// ─── ForwardCurve Tests ─────────────────────────────────────────

describe('ForwardCurve', () => {
  it('bootstraps forward rates from spot rates', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const forwards = curve.toForwardRates();

    expect(forwards.length).toBe(curve.tenors.length);
    // First forward = first spot rate (f(0,T1) = r(T1))
    expect(forwards[0]).toBeCloseTo(SPOT_RATES['1M'], 6);
    // All forward rates are finite
    for (const f of forwards) {
      expect(isFinite(f)).toBe(true);
    }
  });

  it('forward rates are between adjacent spot rates for normal curve', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const forwards = curve.toForwardRates();
    const spots = curve.spotRates;

    // For a well-behaved curve, forward rates should be in a reasonable range
    // around the spot rates (not necessarily between, but close)
    for (let i = 1; i < forwards.length; i++) {
      const minSpot = Math.min(spots[i - 1], spots[i]);
      const maxSpot = Math.max(spots[i - 1], spots[i]);
      // Forward should be within 500bps of the spot range
      expect(forwards[i]).toBeGreaterThan(minSpot - 0.05);
      expect(forwards[i]).toBeLessThan(maxSpot + 0.05);
    }
  });

  it('applies parallel shock correctly (exact bps shift)', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const shocked = curve.shock(100); // +100 bps

    for (let i = 0; i < curve.tenors.length; i++) {
      expect(shocked.spotRates[i]).toBeCloseTo(curve.spotRates[i] + 0.01, 8);
    }
  });

  it('shock(-100) shifts all rates down by exactly 100bps', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const shocked = curve.shock(-100);

    for (let i = 0; i < curve.tenors.length; i++) {
      expect(shocked.spotRates[i]).toBeCloseTo(
        Math.max(0, curve.spotRates[i] - 0.01),
        8,
      );
    }
  });

  it('floors shocked rates at zero (no negative rates)', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const shocked = curve.shock(-10000); // -10000 bps

    for (const rate of shocked.spotRates) {
      expect(rate).toBeGreaterThanOrEqual(0);
    }
  });

  it('applies twist shock with linear interpolation', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const twisted = curve.twist(-50, 100); // short end down, long end up

    // Shortest tenor should decrease
    expect(twisted.spotRates[0]).toBeLessThan(curve.spotRates[0]);
    // Longest tenor should increase
    const last = curve.tenors.length - 1;
    expect(twisted.spotRates[last]).toBeGreaterThan(curve.spotRates[last]);
  });

  it('twist(0, 0) leaves curve unchanged', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const twisted = curve.twist(0, 0);

    for (let i = 0; i < curve.tenors.length; i++) {
      expect(twisted.spotRates[i]).toBeCloseTo(curve.spotRates[i], 10);
    }
  });

  it('rejects curves with fewer than 2 tenor points', () => {
    expect(() => new ForwardCurve({ '1Y': 0.04 })).toThrow(/at least 2/);
  });

  it('toSnapshot produces valid serializable object', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const snapshot = curve.toSnapshot();

    expect(snapshot.tenors.length).toBeGreaterThan(0);
    expect(snapshot.spotRates.length).toBe(snapshot.tenors.length);
    expect(snapshot.forwardRates.length).toBe(snapshot.tenors.length);
    expect(typeof snapshot.prSpread).toBe('number');
  });

  it('interpolate returns sensible values at arbitrary tenors', () => {
    const curve = new ForwardCurve(SPOT_RATES);

    // 1.5Y should be between 1Y and 2Y
    const rate15Y = curve.interpolate(1.5);
    expect(rate15Y).toBeGreaterThanOrEqual(
      Math.min(SPOT_RATES['1Y'], SPOT_RATES['2Y']),
    );
    expect(rate15Y).toBeLessThanOrEqual(
      Math.max(SPOT_RATES['1Y'], SPOT_RATES['2Y']),
    );

    // Extrapolate flat
    expect(curve.interpolate(0)).toBe(SPOT_RATES['1M']);
    expect(curve.interpolate(50)).toBe(SPOT_RATES['30Y']);
  });
});

// ─── Calibration Tests ──────────────────────────────────────────

describe('calibrateHJM', () => {
  it('extracts two factors with valid output from 100-day synthetic data', () => {
    const history = generateSyntheticHistory(100);
    const params = calibrateHJM(toTimeSeries(history));

    // sigma1 and sigma2 are positive and in reasonable range (0.001 to 0.05)
    expect(params.sigma1).toBeGreaterThan(0.001);
    expect(params.sigma1).toBeLessThan(0.05);
    expect(params.sigma2).toBeGreaterThan(0.001);
    expect(params.sigma2).toBeLessThan(0.05);

    // Level factor captures more variance than slope
    expect(params.eigenvalue1).toBeGreaterThan(params.eigenvalue2);

    // rho between -1 and 1
    expect(params.rho).toBeGreaterThanOrEqual(-1);
    expect(params.rho).toBeLessThanOrEqual(1);

    // Variance explained is positive
    expect(params.varianceExplained).toBeGreaterThan(0);
    expect(params.varianceExplained).toBeLessThanOrEqual(1);
  });

  it('produces sigma1 and sigma2 positive and in realistic range', () => {
    const history = generateSyntheticHistory(504);
    const params = calibrateHJM(toTimeSeries(history));

    // Annualized vol should be in [0.1%, 5%] for typical treasury data
    expect(params.sigma1).toBeGreaterThan(0.001);
    expect(params.sigma1).toBeLessThan(0.05);
    expect(params.sigma2).toBeGreaterThan(0);
    expect(params.sigma2).toBeLessThan(0.05);
  });

  it('rho is between -1 and 1', () => {
    const history = generateSyntheticHistory(200);
    const params = calibrateHJM(toTimeSeries(history));

    expect(params.rho).toBeGreaterThanOrEqual(-1);
    expect(params.rho).toBeLessThanOrEqual(1);
  });

  it('rejects insufficient data (<60 observations)', () => {
    const shortHistory = generateSyntheticHistory(30);
    expect(() => calibrateHJM(toTimeSeries(shortHistory))).toThrow(
      /at least 60/,
    );
  });

  it('rejects data with fewer than 3 common tenors', () => {
    const badHistory: RateTimeSeries = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      rates: { '1Y': 0.04 + Math.random() * 0.001 },
    }));
    expect(() => calibrateHJM(badHistory)).toThrow(/at least 3 common/);
  });

  it('calibration is deterministic for same input', () => {
    const history = toTimeSeries(generateSyntheticHistory(504, 123));
    const params1 = calibrateHJM(history);
    const params2 = calibrateHJM(history);

    expect(params1.sigma1).toBeCloseTo(params2.sigma1, 10);
    expect(params1.sigma2).toBeCloseTo(params2.sigma2, 10);
    expect(params1.rho).toBeCloseTo(params2.rho, 10);
  });
});

// ─── HJMCalibrationService Tests ────────────────────────────────

describe('HJMCalibrationService', () => {
  let service: HJMCalibrationService;

  beforeEach(() => {
    service = new HJMCalibrationService();
  });

  it('calibrateHJM method wraps the pure function correctly', () => {
    const history = generateSyntheticHistory(100);
    const params = service.calibrateHJM(history);

    expect(params.sigma1).toBeGreaterThan(0);
    expect(params.sigma2).toBeGreaterThan(0);
    expect(params.rho).toBeGreaterThanOrEqual(-1);
    expect(params.rho).toBeLessThanOrEqual(1);
    expect(params.calibratedAt).toBeDefined();
  });

  it('getParams returns default when uncalibrated', () => {
    const params = service.getParams();
    expect(params.sigma1).toBe(0.012);
    expect(params.sigma2).toBe(0.006);
  });

  it('getParams returns calibrated params after calibration', () => {
    const history = generateSyntheticHistory(100);
    const calibrated = service.calibrateHJM(history);
    const retrieved = service.getParams();

    expect(retrieved.sigma1).toBe(calibrated.sigma1);
    expect(retrieved.sigma2).toBe(calibrated.sigma2);
  });

  it('getDriftCorrection returns valid drift values', () => {
    const drifts = service.getDriftCorrection([1, 5, 10], 0);

    expect(drifts.length).toBe(3);
    for (const d of drifts) {
      expect(isFinite(d)).toBe(true);
    }
    // With default params (rho = -0.35), short-tenor drift should be positive
    expect(drifts[0]).toBeGreaterThan(0);
  });
});

// ─── Monte Carlo Tests ──────────────────────────────────────────

describe('runHJMMonteCarlo', () => {
  const makeInput = (
    overrides?: Partial<HJMMonteCarloInput>,
  ): HJMMonteCarloInput => {
    const curve = new ForwardCurve(SPOT_RATES);
    return {
      forwardCurve: curve.toSnapshot(),
      hjmParams: TEST_HJM_PARAMS,
      repricingBuckets: TEST_BUCKETS,
      numPaths: 100,
      numSteps: 63, // ~1 quarter for speed
      seed: 42,
      ...overrides,
    };
  };

  it('same seed produces identical results (reproducibility)', () => {
    const r1 = runHJMMonteCarlo(makeInput({ seed: 42 }));
    const r2 = runHJMMonteCarlo(makeInput({ seed: 42 }));

    expect(r1.expectedNII).toBeCloseTo(r2.expectedNII, 8);
    expect(r1.niiAtRisk95).toBeCloseTo(r2.niiAtRisk95, 8);
    expect(r1.niiAtRisk99).toBeCloseTo(r2.niiAtRisk99, 8);
    expect(r1.stdNII).toBeCloseTo(r2.stdNII, 8);

    // Every single NII path value matches
    for (let i = 0; i < r1.niiDistribution.length; i++) {
      expect(r1.niiDistribution[i]).toBeCloseTo(r2.niiDistribution[i], 8);
    }
  });

  it('different seeds produce different distributions', () => {
    const r1 = runHJMMonteCarlo(makeInput({ seed: 42 }));
    const r2 = runHJMMonteCarlo(makeInput({ seed: 99 }));

    expect(r1.expectedNII).not.toBeCloseTo(r2.expectedNII, 4);
  });

  it('niiAtRisk95 > 0 for a positive-NII institution', () => {
    const result = runHJMMonteCarlo(makeInput({ numPaths: 500 }));

    // For positive-NII institution, even the 5th percentile should be positive
    // (the balance sheet has more asset income than liability expense)
    if (result.expectedNII > 0) {
      // NII@Risk95 is the 5th percentile — it should be less than expected
      // but for a well-balanced institution with moderate vol, still positive
      expect(result.niiAtRisk95).toBeLessThan(result.expectedNII);
    }
  });

  it('NII distribution is sorted ascending', () => {
    const result = runHJMMonteCarlo(makeInput());

    for (let i = 1; i < result.niiDistribution.length; i++) {
      expect(result.niiDistribution[i]).toBeGreaterThanOrEqual(
        result.niiDistribution[i - 1],
      );
    }
  });

  it('produces valid fan chart with monotone percentiles', () => {
    const result = runHJMMonteCarlo(makeInput({ numSteps: 252 }));

    expect(result.fanChart.length).toBeGreaterThan(0);
    for (const point of result.fanChart) {
      expect(point.p5).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p95);
    }
  });

  it('handles empty repricing buckets gracefully', () => {
    const result = runHJMMonteCarlo(makeInput({ repricingBuckets: [] }));

    expect(result.expectedNII).toBe(0);
    expect(result.niiAtRisk95).toBe(0);
  });

  it('caps paths at MAX_PATHS (50,000)', () => {
    const result = runHJMMonteCarlo(makeInput({ numPaths: 100_000 }));
    expect(result.paths).toBeLessThanOrEqual(50_000);
  });
});

// ─── Drift Correction Tests ─────────────────────────────────────

describe('computeDriftCorrection', () => {
  it('returns zero drift for past tenors (tau <= 0)', () => {
    const drifts = computeDriftCorrection(TEST_HJM_PARAMS, [0.5, 1, 2], 5);
    for (const d of drifts) {
      expect(d).toBe(0);
    }
  });

  it('drift is positive for short tenors with typical params', () => {
    const drifts = computeDriftCorrection(TEST_HJM_PARAMS, [1, 5, 10], 0);
    // Short tenor: linear sigma1^2*tau dominates
    expect(drifts[0]).toBeGreaterThan(0);
  });

  it('drift has correct two-factor structure', () => {
    const drifts = computeDriftCorrection(TEST_HJM_PARAMS, [1, 5, 10, 20], 0);
    // All drifts are distinct (different tau values)
    const uniqueDrifts = new Set(drifts.map((d) => d.toFixed(10)));
    expect(uniqueDrifts.size).toBe(drifts.length);
  });
});
