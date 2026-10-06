// ─── HJM Two-Factor Forward Curve Engine — Type Definitions ─────
//
// Heath-Jarrow-Morton (1992) framework for full forward-curve evolution.
// Two factors: level (parallel shifts) + slope (twist).
// Calibrated from US Treasury H.15 + PR municipal spread.
//
// Why HJM over Vasicek/Hull-White?
// - Vasicek models a single short rate. HJM models the ENTIRE forward curve.
// - When COSSEC examiners ask "how does your model account for non-parallel
//   curve shifts?", CerniQ answers with HJM.
// - Two-factor HJM is the industry standard for community bank/CU ALM.

/** Standard tenor grid (years). Matches US Treasury constant maturity tenors. */
export const HJM_TENORS = [
  1 / 12, // 1M
  3 / 12, // 3M
  6 / 12, // 6M
  1,
  2,
  3,
  5,
  7,
  10,
  20,
  30,
] as const;

export const HJM_TENOR_LABELS = [
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
] as const;

export type TenorLabel = (typeof HJM_TENOR_LABELS)[number];

/** A single day of observed spot rates by tenor. */
export interface RateObservation {
  date: string; // ISO date
  rates: Record<string, number>; // tenor label → annualized spot rate (e.g., '1Y' → 0.044)
}

/** Historical rate time series used for calibration. */
export type RateTimeSeries = RateObservation[];

/** HJM calibration output: two-factor volatility structure. */
export interface HJMParams {
  sigma1: number; // level factor volatility (annualized)
  sigma2: number; // slope factor volatility (annualized)
  rho: number; // correlation between factors
  eigenvalue1: number; // first eigenvalue (variance explained by level)
  eigenvalue2: number; // second eigenvalue (variance explained by slope)
  varianceExplained: number; // (ev1 + ev2) / total — should be > 0.90
  tenors: number[]; // tenor grid used
  calibratedAt: string; // ISO timestamp
  sampleSize: number; // number of daily observations used
  lookbackYears: number;
}

/** Forward rate curve at a point in time. */
export interface ForwardCurveSnapshot {
  tenors: number[];
  spotRates: number[];
  forwardRates: number[];
  prSpread: number; // PR municipal spread over UST (bps)
}

/** Balance sheet repricing bucket for NII computation. */
export interface RepricingBucket {
  tenor: number; // years to repricing
  assetBalance: number;
  assetRate: number;
  liabilityBalance: number;
  liabilityRate: number;
}

/** Input for Monte Carlo simulation. */
export interface HJMMonteCarloInput {
  forwardCurve: ForwardCurveSnapshot;
  hjmParams: HJMParams;
  repricingBuckets: RepricingBucket[];
  numPaths: number;
  numSteps: number; // daily steps (252 = 1 year)
  seed: number;
}

/** Per-path NII outcome. */
export interface PathResult {
  nii: number; // net interest income over horizon
  eveChange: number; // economic value of equity change
}

/** Full Monte Carlo result. */
export interface HJMMonteCarloResult {
  paths: number;
  steps: number;
  seed: number;
  hjmParams: HJMParams;
  niiDistribution: number[];
  eveDistribution: number[];
  expectedNII: number;
  stdNII: number;
  niiAtRisk95: number; // 5th percentile NII (worst 5%)
  niiAtRisk99: number; // 1st percentile NII (worst 1%)
  expectedEVE: number;
  eveAtRisk95: number;
  eveAtRisk99: number;
  convergenceMet: boolean;
  standardError: number;
  computeTimeMs: number;
  fanChart: Array<{
    step: number;
    dayLabel: string;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  }>;
}
