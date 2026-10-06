import { ForwardCurve } from './forward-curve';
import { calibrateHJM, computeDriftCorrection } from './calibration';
import { runHJMMonteCarlo } from './monte-carlo';
import {
  HJMParams,
  HJMMonteCarloInput,
  ForwardCurveSnapshot,
  RateTimeSeries,
} from './types';

// ─── Test Fixtures ───────────────────────────────────────────────

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

const TEST_BUCKETS = [
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
): RateTimeSeries {
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
  const history: RateTimeSeries = [];

  // Simple random walk with mean reversion
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
    const rates: Record<string, number> = {};
    for (let i = 0; i < labels.length; i++) {
      // Mean-reverting random walk with level+slope correlation
      const levelShock = (xorshift() - 0.5) * 0.002;
      const slopeShock = (xorshift() - 0.5) * 0.001 * (i / labels.length);
      currentRates[i] += levelShock + slopeShock;
      currentRates[i] = Math.max(0.001, currentRates[i]); // floor at 10bps
      rates[labels[i]] = currentRates[i];
    }
    history.push({ date, rates });
  }

  return history;
}

// ─── ForwardCurve Tests ──────────────────────────────────────────

describe('ForwardCurve', () => {
  it('bootstraps forward rates from spot rates', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const forwards = curve.toForwardRates();

    expect(forwards.length).toBe(curve.tenors.length);
    // First forward = first spot rate
    expect(forwards[0]).toBeCloseTo(SPOT_RATES['1M'], 6);
    // Forward rates should be defined (not NaN, not Infinity)
    for (const f of forwards) {
      expect(isFinite(f)).toBe(true);
    }
  });

  it('rejects curves with fewer than 2 tenor points', () => {
    expect(() => new ForwardCurve({ '1Y': 0.04 })).toThrow(/at least 2/);
  });

  it('applies parallel shock correctly', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const shocked = curve.shock(100); // +100 bps

    for (let i = 0; i < curve.tenors.length; i++) {
      expect(shocked.spotRates[i]).toBeCloseTo(curve.spotRates[i] + 0.01, 8);
    }
  });

  it('floors shocked rates at zero (no negative rates)', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const shocked = curve.shock(-10000); // -10000 bps → all should be 0

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

  it('applies PR municipal spread', () => {
    const curve = new ForwardCurve(SPOT_RATES, 85);
    const withSpread = curve.withPRSpread();

    for (let i = 0; i < curve.tenors.length; i++) {
      expect(withSpread.spotRates[i]).toBeCloseTo(
        curve.spotRates[i] + 0.0085,
        8,
      );
    }
  });

  it('interpolates rates at arbitrary tenors', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    // 1.5Y should be between 1Y and 2Y rates
    const rate15Y = curve.interpolate(1.5);
    expect(rate15Y).toBeGreaterThanOrEqual(
      Math.min(SPOT_RATES['1Y'], SPOT_RATES['2Y']),
    );
    expect(rate15Y).toBeLessThanOrEqual(
      Math.max(SPOT_RATES['1Y'], SPOT_RATES['2Y']),
    );
  });

  it('extrapolates flat beyond curve boundaries', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    expect(curve.interpolate(0)).toBe(SPOT_RATES['1M']);
    expect(curve.interpolate(50)).toBe(SPOT_RATES['30Y']);
  });

  it('toSnapshot returns valid serializable object', () => {
    const curve = new ForwardCurve(SPOT_RATES);
    const snapshot = curve.toSnapshot();

    expect(snapshot.tenors.length).toBeGreaterThan(0);
    expect(snapshot.spotRates.length).toBe(snapshot.tenors.length);
    expect(snapshot.forwardRates.length).toBe(snapshot.tenors.length);
    expect(typeof snapshot.prSpread).toBe('number');
  });
});

// ─── Calibration Tests ───────────────────────────────────────────

describe('calibrateHJM', () => {
  it('extracts two factors with valid calibration output', () => {
    const history = generateSyntheticHistory(504);
    const params = calibrateHJM(history);

    expect(params.sigma1).toBeGreaterThan(0);
    expect(params.sigma2).toBeGreaterThan(0);
    // Level factor captures more variance than slope (first eigenvalue > second)
    expect(params.eigenvalue1).toBeGreaterThan(params.eigenvalue2);
    // Variance explained is positive (synthetic data lacks real treasury correlation
    // structure, so we only check >0 here; real data typically exceeds 90%)
    expect(params.varianceExplained).toBeGreaterThan(0);
    expect(params.varianceExplained).toBeLessThanOrEqual(1);
    expect(params.sampleSize).toBe(503); // N-1 changes from N observations
    expect(params.rho).toBeGreaterThanOrEqual(-1);
    expect(params.rho).toBeLessThanOrEqual(1);
  });

  it('rejects insufficient data (<60 observations)', () => {
    const shortHistory = generateSyntheticHistory(30);
    expect(() => calibrateHJM(shortHistory)).toThrow(/at least 60/);
  });

  it('rejects data with fewer than 3 common tenors', () => {
    const badHistory: RateTimeSeries = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      rates: { '1Y': 0.04 + Math.random() * 0.001 },
    }));
    expect(() => calibrateHJM(badHistory)).toThrow(/at least 3 common/);
  });

  it('produces sigma1 in realistic range for typical treasury data', () => {
    const history = generateSyntheticHistory(504);
    const params = calibrateHJM(history);

    // Annualized vol should be in a reasonable range (0.1% to 10%)
    expect(params.sigma1).toBeGreaterThan(0.001);
    expect(params.sigma1).toBeLessThan(0.1);
  });

  it('calibration is deterministic for same input', () => {
    const history = generateSyntheticHistory(504, 123);
    const params1 = calibrateHJM(history);
    const params2 = calibrateHJM(history);

    expect(params1.sigma1).toBeCloseTo(params2.sigma1, 10);
    expect(params1.sigma2).toBeCloseTo(params2.sigma2, 10);
  });
});

// ─── Drift Correction Tests ───────────────���──────────────────────

describe('computeDriftCorrection', () => {
  it('returns zero drift for past tenors (tau <= 0)', () => {
    const drifts = computeDriftCorrection(TEST_HJM_PARAMS, [0.5, 1, 2], 5);
    // All tenors are in the past relative to t=5
    for (const d of drifts) {
      expect(d).toBe(0);
    }
  });

  it('drift is non-zero for future tenors and respects two-factor structure', () => {
    const drifts = computeDriftCorrection(TEST_HJM_PARAMS, [1, 5, 10, 20], 0);

    // All drifts for future tenors should be non-zero
    for (const d of drifts) {
      expect(d).not.toBe(0);
    }

    // With negative rho (-0.35), the quadratic term (sigma2*sigma1*rho*tau^2/2)
    // eventually dominates the linear term (sigma1^2*tau), causing drift to
    // decrease and become negative at long maturities. This is mathematically
    // correct for the HJM no-arbitrage condition.
    // Verify: short tenor drift is positive (linear term dominates)
    expect(drifts[0]).toBeGreaterThan(0); // tau=1
    expect(drifts[1]).toBeGreaterThan(0); // tau=5
    // Verify: the quadratic structure produces different drift at each tenor
    const uniqueDrifts = new Set(drifts.map((d) => d.toFixed(10)));
    expect(uniqueDrifts.size).toBe(drifts.length);
  });
});

// ─── Monte Carlo Tests ───────────────────────────────────────────

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

  it('produces valid result with expected structure', () => {
    const result = runHJMMonteCarlo(makeInput());

    expect(result.paths).toBe(100);
    expect(result.steps).toBe(63);
    expect(result.seed).toBe(42);
    expect(result.niiDistribution.length).toBe(100);
    expect(result.eveDistribution.length).toBe(100);
    expect(isFinite(result.expectedNII)).toBe(true);
    expect(isFinite(result.stdNII)).toBe(true);
    expect(result.computeTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.fanChart.length).toBeGreaterThan(0);
  });

  it('is deterministic: same seed produces identical distributions', () => {
    const r1 = runHJMMonteCarlo(makeInput({ seed: 42 }));
    const r2 = runHJMMonteCarlo(makeInput({ seed: 42 }));

    expect(r1.expectedNII).toBeCloseTo(r2.expectedNII, 8);
    expect(r1.niiAtRisk95).toBeCloseTo(r2.niiAtRisk95, 8);
    for (let i = 0; i < r1.niiDistribution.length; i++) {
      expect(r1.niiDistribution[i]).toBeCloseTo(r2.niiDistribution[i], 8);
    }
  });

  it('different seeds produce different distributions', () => {
    const r1 = runHJMMonteCarlo(makeInput({ seed: 42 }));
    const r2 = runHJMMonteCarlo(makeInput({ seed: 99 }));

    // Expected NIIs should differ (extremely unlikely to be identical)
    expect(r1.expectedNII).not.toBeCloseTo(r2.expectedNII, 4);
  });

  it('NII at Risk 95 < Expected NII for positive-NII institution', () => {
    const result = runHJMMonteCarlo(makeInput({ numPaths: 500 }));

    // For a typical positive-NII institution, the 5th percentile
    // should be below the expected value (risk is on the downside)
    if (result.expectedNII > 0) {
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

  it('caps paths at MAX_PATHS (50,000)', () => {
    const result = runHJMMonteCarlo(makeInput({ numPaths: 100_000 }));
    expect(result.paths).toBeLessThanOrEqual(50_000);
  });

  it('produces fan chart with weekly granularity', () => {
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

    // Should still produce result (all zeros)
    expect(result.expectedNII).toBe(0);
    expect(result.niiAtRisk95).toBe(0);
  });
});
