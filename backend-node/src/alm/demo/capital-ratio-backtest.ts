/**
 * Backtest / ongoing-monitoring harness for the capital-ratio projection
 * (SR 11-7 model validation — "outcomes analysis").
 *
 * The projection is a seeded Monte Carlo; these checks validate it against
 * CLOSED-FORM theory and structural invariants — deliberately non-circular, so
 * passing means the implementation (seeded RNG → Box–Muller → lognormal severity
 * → copula → breach counting) is correct, not merely self-consistent.
 *
 * The headline check is calibration: drive a single lognormal loss channel and
 * confirm the empirical breach frequency matches the analytic lognormal tail
 * P(S > s*) = 1 − Φ((ln s* + σ²/2)/σ). If the sampler or the transform were
 * wrong, this diverges.
 *
 * Runnable (`npm run demo:sic -- --backtest`) and CI-locked
 * (`capital-ratio-backtest.spec.ts`). Deterministic given the seed scheme.
 */
import { projectCapitalRatioUnderStress } from './capital-ratio-projection';

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (accurate to ~7.5e-8). */
function normalCdf(x: number): number {
  if (x < 0) return 1 - normalCdf(-x);
  const t = 1 / (1 + 0.2316419 * x);
  const phi = Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - phi * poly;
}

function std(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(v);
}

export interface BacktestCheck {
  name: string;
  passed: boolean;
  detail: string;
  metrics: Record<string, number>;
}

export interface BacktestReport {
  passed: boolean;
  seeds: number;
  paths: number;
  checks: BacktestCheck[];
}

export interface BacktestOptions {
  /** Independent seeds averaged per check (default 12). */
  seeds?: number;
  /** Monte Carlo paths per run (default 20000). */
  paths?: number;
}

// Fixed reference institution for the validation (values are test inputs, not
// outputs): $25M equity / $250M assets / 7% floor / 40% severity CV.
const E = 25;
const A = 250;
const FLOOR = 7;
const CV = 0.4;

/**
 * Run the projection backtest. Returns a structured report; `passed` is the
 * conjunction of all checks. Pure + deterministic (seeds are derived by index).
 */
export function backtestProjectionCalibration(
  opts: BacktestOptions = {},
): BacktestReport {
  const seeds = Math.max(2, Math.floor(opts.seeds ?? 12));
  const paths = Math.max(2000, Math.floor(opts.paths ?? 20000));
  const sigma = Math.sqrt(Math.log(1 + CV * CV));
  const checks: BacktestCheck[] = [];

  // ── Single-channel runs (credit only) for calibration + mean + ordering ──
  const L = 5; // chosen so the analytic breach probability is a non-trivial ~10%
  const sStar = (E - (FLOOR / 100) * A) / L; // S threshold above which we breach
  const theoBreachPct =
    100 * (1 - normalCdf((Math.log(sStar) + (sigma * sigma) / 2) / sigma));
  const detRatio = ((E - L) / A) * 100; // deterministic centre (E[S]=1)

  const breaches: number[] = [];
  const means: number[] = [];
  let orderingOk = true;
  for (let i = 0; i < seeds; i++) {
    const r = projectCapitalRatioUnderStress({
      baseEquity: E,
      totalAssets: A,
      cossecMinimumPct: FLOOR,
      deterministicLosses: { creditLoss: L, depositCost: 0, niiShortfall: 0 },
      assumptions: { creditSeverityCv: CV },
      seed: `bt-single-${i}`,
      paths,
    });
    breaches.push(r.breachProbabilityPct);
    means.push(r.meanCapitalRatioPct);
    const d = r.distribution;
    if (
      !(d.p5 <= d.p25 && d.p25 <= d.p50 && d.p50 <= d.p75 && d.p75 <= d.p95)
    ) {
      orderingOk = false;
    }
  }
  const empBreach = breaches.reduce((s, x) => s + x, 0) / seeds;
  const breachErr = Math.abs(empBreach - theoBreachPct);
  checks.push({
    name: 'breach-calibration',
    passed: breachErr < 0.5,
    detail: `empirical breach ${empBreach.toFixed(2)}% vs closed-form lognormal tail ${theoBreachPct.toFixed(2)}% (|err| ${breachErr.toFixed(2)}pp, tol 0.50pp)`,
    metrics: {
      empirical: empBreach,
      theoretical: theoBreachPct,
      absErrorPp: breachErr,
    },
  });

  const empMean = means.reduce((s, x) => s + x, 0) / seeds;
  const meanErr = Math.abs(empMean - detRatio);
  checks.push({
    name: 'mean-unbiased',
    passed: meanErr < 0.05,
    detail: `mean stressed ratio ${empMean.toFixed(3)}% vs deterministic centre ${detRatio.toFixed(3)}% (|err| ${meanErr.toFixed(3)}pp, tol 0.05pp)`,
    metrics: {
      empirical: empMean,
      deterministic: detRatio,
      absErrorPp: meanErr,
    },
  });

  checks.push({
    name: 'percentile-ordering',
    passed: orderingOk,
    detail: `p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 held across all ${seeds} seeds`,
    metrics: { seeds },
  });

  // ── Convergence: cross-seed std of the mean shrinks as paths grow (∝ 1/√N) ──
  const meansAt = (n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < seeds; i++) {
      out.push(
        projectCapitalRatioUnderStress({
          baseEquity: E,
          totalAssets: A,
          cossecMinimumPct: FLOOR,
          deterministicLosses: {
            creditLoss: L,
            depositCost: 0,
            niiShortfall: 0,
          },
          assumptions: { creditSeverityCv: CV },
          seed: `bt-conv-${n}-${i}`,
          paths: n,
        }).meanCapitalRatioPct,
      );
    }
    return out;
  };
  const lowN = Math.max(500, Math.floor(paths / 20));
  const stdLow = std(meansAt(lowN));
  const stdHigh = std(meansAt(paths));
  checks.push({
    name: 'convergence',
    passed: stdHigh < stdLow,
    detail: `cross-seed std of mean falls ${stdLow.toFixed(4)} (N=${lowN}) → ${stdHigh.toFixed(4)} (N=${paths})`,
    metrics: { stdLow, stdHigh, lowN, highN: paths },
  });

  // ── Copula: a shared systemic factor fattens the tail (ρ↑ ⇒ p95−p5↑) ──
  const losses = { creditLoss: 6, depositCost: 6, niiShortfall: 6 };
  const widthAt = (rho: number): number => {
    const r = projectCapitalRatioUnderStress({
      baseEquity: E,
      totalAssets: A,
      cossecMinimumPct: FLOOR,
      deterministicLosses: losses,
      assumptions: { systemicCorrelation: rho },
      seed: 'bt-rho',
      paths,
    });
    return r.distribution.p95 - r.distribution.p5;
  };
  const widthLow = widthAt(0.1);
  const widthHigh = widthAt(0.9);
  checks.push({
    name: 'copula-tail-widening',
    passed: widthHigh > widthLow,
    detail: `p95−p5 widens ${widthLow.toFixed(3)} (ρ=0.1) → ${widthHigh.toFixed(3)} (ρ=0.9)`,
    metrics: { widthLowRho: widthLow, widthHighRho: widthHigh },
  });

  return {
    passed: checks.every((c) => c.passed),
    seeds,
    paths,
    checks,
  };
}
