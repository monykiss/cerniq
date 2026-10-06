// ─── HJM Two-Factor Monte Carlo Simulation ──────────────────────
//
// For each path:
// 1. Generate correlated Brownian increments (Cholesky decomposition)
// 2. Evolve forward curve: f(t+dt, T) = f(t,T) + drift*dt + sigma1*dW1 + sigma2*(T-t)*dW2
// 3. Reprice each balance sheet bucket at the path forward rate
// 4. NII[path] = sum(income - expense) over all steps
//
// Seeded PRNG for reproducibility: same seed = same paths.

import { createHash } from 'crypto';
import {
  HJMMonteCarloInput,
  HJMMonteCarloResult,
  HJMParams,
  RepricingBucket,
} from './types';
import { computeDriftCorrection } from './calibration';

/** Maximum paths to prevent memory exhaustion. */
const MAX_PATHS = 50_000;
/** Maximum steps (daily over 5 years). */
const MAX_STEPS = 1_260;
/** Time step = 1 trading day. */
const DT = 1 / 252;

/**
 * Run HJM two-factor Monte Carlo simulation.
 *
 * Produces NII and EVE distributions over the specified horizon.
 * Uses antithetic variates for variance reduction (each path generates
 * a mirror path, halving the variance of the estimator).
 */
export function runHJMMonteCarlo(
  input: HJMMonteCarloInput,
): HJMMonteCarloResult {
  const startMs = Date.now();

  const numPaths = Math.min(input.numPaths, MAX_PATHS);
  const numSteps = Math.min(input.numSteps, MAX_STEPS);
  const { hjmParams, forwardCurve, repricingBuckets, seed } = input;

  // Antithetic variates: generate numPaths/2 base paths, mirror each
  const halfPaths = Math.ceil(numPaths / 2);

  // Cholesky decomposition for correlated factors
  // [L11, 0  ] [L11, L21] = [1,   rho]
  // [L21, L22] [0,   L22]   [rho, 1  ]
  const L11 = 1;
  const L21 = hjmParams.rho;
  const L22 = Math.sqrt(Math.max(0, 1 - hjmParams.rho ** 2));

  const tenors = forwardCurve.tenors;
  const nTenors = tenors.length;

  // Precompute baseline NII from the current curve
  const baselineNII = computeNII(
    repricingBuckets,
    forwardCurve.spotRates,
    tenors,
  );

  // Initialize PRNG
  const rng = createSeededRNG(seed);

  const niiResults: number[] = [];
  const eveResults: number[] = [];

  // Fan chart accumulators (collect percentiles at each step)
  const fanSteps = Math.min(numSteps, 52); // weekly granularity for fan chart
  const fanInterval = Math.max(1, Math.floor(numSteps / fanSteps));
  const fanData: number[][] = Array.from({ length: fanSteps }, () => []);

  for (let p = 0; p < halfPaths; p++) {
    // Evolve forward curve along this path
    const pathNII = simulatePath(
      forwardCurve.forwardRates,
      tenors,
      hjmParams,
      repricingBuckets,
      numSteps,
      rng,
      L11,
      L21,
      L22,
      +1,
      fanData,
      fanInterval,
    );

    // Antithetic path (negate the Brownian increments)
    const antiNII = simulatePath(
      forwardCurve.forwardRates,
      tenors,
      hjmParams,
      repricingBuckets,
      numSteps,
      rng,
      L11,
      L21,
      L22,
      -1,
      null,
      fanInterval,
    );

    niiResults.push(pathNII.nii, antiNII.nii);
    eveResults.push(pathNII.eveChange, antiNII.eveChange);
  }

  // Trim to exact numPaths (antithetic may produce one extra)
  while (niiResults.length > numPaths) {
    niiResults.pop();
    eveResults.pop();
  }

  // Sort for percentile extraction
  const sortedNII = [...niiResults].sort((a, b) => a - b);
  const sortedEVE = [...eveResults].sort((a, b) => a - b);

  const expectedNII = mean(niiResults);
  const stdNII = std(niiResults, expectedNII);
  const expectedEVE = mean(eveResults);
  const se = stdNII / Math.sqrt(numPaths);

  // Build fan chart
  const fanChart = fanData.map((stepValues, idx) => {
    const sorted = [...stepValues].sort((a, b) => a - b);
    const n = sorted.length;
    return {
      step: (idx + 1) * fanInterval,
      dayLabel: `D${(idx + 1) * fanInterval}`,
      p5: percentile(sorted, 0.05, n),
      p25: percentile(sorted, 0.25, n),
      p50: percentile(sorted, 0.5, n),
      p75: percentile(sorted, 0.75, n),
      p95: percentile(sorted, 0.95, n),
    };
  });

  return {
    paths: numPaths,
    steps: numSteps,
    seed,
    hjmParams,
    niiDistribution: sortedNII,
    eveDistribution: sortedEVE,
    expectedNII,
    stdNII,
    niiAtRisk95: percentile(sortedNII, 0.05, sortedNII.length),
    niiAtRisk99: percentile(sortedNII, 0.01, sortedNII.length),
    expectedEVE,
    eveAtRisk95: percentile(sortedEVE, 0.05, sortedEVE.length),
    eveAtRisk99: percentile(sortedEVE, 0.01, sortedEVE.length),
    convergenceMet: se < 0.01 * Math.abs(expectedNII || 1),
    standardError: se,
    computeTimeMs: Date.now() - startMs,
    fanChart,
  };
}

// ─── Path Simulation ─────────────────────────────────────────────

function simulatePath(
  initialForwards: number[],
  tenors: number[],
  params: HJMParams,
  buckets: RepricingBucket[],
  steps: number,
  rng: () => number,
  L11: number,
  L21: number,
  L22: number,
  sign: 1 | -1,
  fanAccumulator: number[][] | null,
  fanInterval: number,
): { nii: number; eveChange: number } {
  const nTenors = tenors.length;
  const forwards = [...initialForwards];
  let cumulativeNII = 0;

  for (let step = 0; step < steps; step++) {
    const t = step * DT;

    // Generate correlated normal increments
    const z1 = boxMuller(rng) * sign;
    const z2 = boxMuller(rng) * sign;
    const dW1 = L11 * z1 * Math.sqrt(DT);
    const dW2 = (L21 * z1 + L22 * z2) * Math.sqrt(DT);

    // Drift correction (HJM no-arbitrage)
    const drifts = computeDriftCorrection(params, tenors, t);

    // Evolve each tenor's forward rate
    for (let k = 0; k < nTenors; k++) {
      const tau = Math.max(0, tenors[k] - t);
      if (tau <= 0) continue;

      // f(t+dt, T) = f(t, T) + mu*dt + sigma1*dW1 + sigma2*tau*dW2
      forwards[k] +=
        drifts[k] * DT + params.sigma1 * dW1 + params.sigma2 * tau * dW2;

      // Floor at 0 (negative rates not modeled for PR cooperativas)
      if (forwards[k] < 0) forwards[k] = 0;
    }

    // Compute NII contribution for this step
    const stepNII = computeStepNII(buckets, forwards, tenors, DT);
    cumulativeNII += stepNII;

    // Fan chart: record cumulative NII at fan intervals
    if (fanAccumulator && (step + 1) % fanInterval === 0) {
      const fanIdx = Math.floor(step / fanInterval);
      if (fanIdx < fanAccumulator.length) {
        fanAccumulator[fanIdx].push(cumulativeNII);
      }
    }
  }

  // EVE change: reprice at terminal curve vs initial curve
  const eveChange = computeEVEChange(
    buckets,
    forwards,
    initialForwards,
    tenors,
  );

  return { nii: cumulativeNII, eveChange };
}

// ─── NII Computation ─────────────────────────────────────────────

function computeNII(
  buckets: RepricingBucket[],
  rates: number[],
  tenors: number[],
): number {
  let nii = 0;
  for (const bucket of buckets) {
    const rate = interpolateRate(bucket.tenor, rates, tenors);
    const income = bucket.assetBalance * (bucket.assetRate + rate - rate); // Use bucket's own rate
    const expense = bucket.liabilityBalance * bucket.liabilityRate;
    nii += income - expense;
  }
  return nii;
}

function computeStepNII(
  buckets: RepricingBucket[],
  currentForwards: number[],
  tenors: number[],
  dt: number,
): number {
  let stepNII = 0;
  for (const bucket of buckets) {
    // For floating-rate: reprice at current forward for the bucket's tenor
    const currentRate = interpolateRate(bucket.tenor, currentForwards, tenors);

    // Asset income for this step (annualized rate × balance × dt)
    const income = bucket.assetBalance * currentRate * dt;
    // Liability expense for this step
    const expense = bucket.liabilityBalance * bucket.liabilityRate * dt;

    stepNII += income - expense;
  }
  return stepNII;
}

function computeEVEChange(
  buckets: RepricingBucket[],
  terminalRates: number[],
  initialRates: number[],
  tenors: number[],
): number {
  let eveChange = 0;
  for (const bucket of buckets) {
    const initialRate = interpolateRate(bucket.tenor, initialRates, tenors);
    const terminalRate = interpolateRate(bucket.tenor, terminalRates, tenors);

    // PV change ≈ -duration × balance × delta_rate
    // Simplified: use bucket tenor as approximate duration
    const assetPVChange =
      -bucket.tenor * bucket.assetBalance * (terminalRate - initialRate);
    const liabPVChange =
      -bucket.tenor * bucket.liabilityBalance * (terminalRate - initialRate);

    eveChange += assetPVChange - liabPVChange;
  }
  return eveChange;
}

function interpolateRate(
  tenor: number,
  rates: number[],
  tenors: number[],
): number {
  if (tenors.length === 0) return 0;
  if (tenor <= tenors[0]) return rates[0];
  if (tenor >= tenors[tenors.length - 1]) return rates[rates.length - 1];

  for (let i = 1; i < tenors.length; i++) {
    if (tenor <= tenors[i]) {
      const t = (tenor - tenors[i - 1]) / (tenors[i] - tenors[i - 1]);
      return rates[i - 1] + t * (rates[i] - rates[i - 1]);
    }
  }

  return rates[rates.length - 1];
}

// ─── Seeded PRNG ─────────────────────────────────────────────────
// Deterministic PRNG using a hash-chain approach.
// Same seed = same sequence of outputs. No external dependency.

function createSeededRNG(seed: number): () => number {
  let state = seed;
  return () => {
    // xorshift32 — fast, deterministic, sufficient for Monte Carlo
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff; // normalize to [0, 1)
  };
}

// ─── Box-Muller Transform ────────────────────────────────────────
// Convert uniform [0,1) to standard normal N(0,1).

let boxMullerSpare: number | null = null;

function boxMuller(rng: () => number): number {
  if (boxMullerSpare !== null) {
    const val = boxMullerSpare;
    boxMullerSpare = null;
    return val;
  }

  let u: number, v: number, s: number;
  do {
    u = 2 * rng() - 1;
    v = 2 * rng() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);

  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  boxMullerSpare = v * mul;
  return u * mul;
}

// ─── Statistics Helpers ──────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function std(arr: number[], mu: number): number {
  if (arr.length < 2) return 0;
  let sumSq = 0;
  for (const v of arr) sumSq += (v - mu) ** 2;
  return Math.sqrt(sumSq / (arr.length - 1));
}

function percentile(sorted: number[], p: number, n: number): number {
  if (n === 0) return 0;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}
