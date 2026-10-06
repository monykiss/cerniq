// ─── HJM Two-Factor Calibration via PCA ─────────────────────────
//
// Input: daily US Treasury constant maturity rates (from FRED H.15).
// Step 1: Compute daily forward rate changes df(t,T) = f(t+1,T) - f(t,T).
// Step 2: PCA on the covariance matrix of forward changes.
// Step 3: First two eigenvalues/eigenvectors = level + slope factors.
// Step 4: sigma_1 = sqrt(eigenvalue_1 / 252), sigma_2 = sqrt(eigenvalue_2 / 252).
//
// The drift correction (HJM no-arbitrage condition):
//   mu(t,T) = sigma(t,T) * integral[t to T] sigma(t,s) ds
// For two-factor:
//   mu = sigma_1^2 * (T-t) + sigma_2 * sigma_1 * rho * (T-t)^2 / 2

import { HJMParams, HJM_TENOR_LABELS, RateTimeSeries } from './types';

/**
 * Calibrate HJM two-factor model from historical rate observations.
 *
 * Uses PCA (Principal Component Analysis) on the covariance matrix of
 * daily forward rate changes to extract the level and slope factors.
 *
 * @param history - Array of daily rate observations, each with rates by tenor label.
 *                  Minimum 60 observations required (≈3 months of trading days).
 * @returns HJMParams with sigma1, sigma2, rho, and diagnostic metadata.
 */
export function calibrateHJM(history: RateTimeSeries): HJMParams {
  if (history.length < 60) {
    throw new Error(
      `HJM calibration requires at least 60 daily observations, got ${history.length}`,
    );
  }

  // Determine common tenors (present in all observations)
  const commonLabels = HJM_TENOR_LABELS.filter((label) =>
    history.every((obs) => label in obs.rates && isFinite(obs.rates[label])),
  );

  if (commonLabels.length < 3) {
    throw new Error(
      `HJM calibration requires at least 3 common tenors, found ${commonLabels.length}: [${commonLabels.join(', ')}]`,
    );
  }

  const n = commonLabels.length;

  // Step 1: Compute daily forward rate changes
  const changes: number[][] = [];
  for (let t = 1; t < history.length; t++) {
    const row: number[] = [];
    for (const label of commonLabels) {
      row.push(history[t].rates[label] - history[t - 1].rates[label]);
    }
    changes.push(row);
  }

  const T = changes.length;

  // Step 2: Compute mean of each column
  const mean = new Array(n).fill(0);
  for (const row of changes) {
    for (let j = 0; j < n; j++) mean[j] += row[j];
  }
  for (let j = 0; j < n; j++) mean[j] /= T;

  // Step 3: Compute covariance matrix
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const row of changes) {
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        cov[i][j] += (row[i] - mean[i]) * (row[j] - mean[j]);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      cov[i][j] /= T - 1;
      cov[j][i] = cov[i][j]; // symmetric
    }
  }

  // Step 4: Extract top 2 eigenvalues/eigenvectors via power iteration
  const { eigenvalue: ev1, eigenvector: vec1 } = powerIteration(cov, n);
  const deflated = deflateMatrix(cov, ev1, vec1, n);
  const { eigenvalue: ev2, eigenvector: vec2 } = powerIteration(deflated, n);

  // Total variance = trace of covariance matrix
  let totalVariance = 0;
  for (let i = 0; i < n; i++) totalVariance += cov[i][i];

  // Annualize: daily vol → annual vol (sqrt(252 trading days))
  const sigma1 = Math.sqrt(ev1 * 252);
  const sigma2 = Math.sqrt(ev2 * 252);

  // Correlation between factors = inner product of eigenvectors
  // By PCA construction, eigenvectors are orthogonal, so rho ≈ 0.
  // But we compute it from the data for numerical honesty.
  let rho = 0;
  for (let i = 0; i < n; i++) rho += vec1[i] * vec2[i];
  // Clamp to [-1, 1] for numerical stability
  rho = Math.max(-1, Math.min(1, rho));

  const lookbackDays = history.length;
  const lookbackYears = lookbackDays / 252;

  return {
    sigma1,
    sigma2,
    rho,
    eigenvalue1: ev1,
    eigenvalue2: ev2,
    varianceExplained: totalVariance > 0 ? (ev1 + ev2) / totalVariance : 0,
    tenors: commonLabels.map((l) => HJM_TENOR_LABELS.indexOf(l)),
    calibratedAt: new Date().toISOString(),
    sampleSize: T,
    lookbackYears: Math.round(lookbackYears * 10) / 10,
  };
}

/**
 * Compute HJM drift correction (no-arbitrage condition).
 *
 * For a two-factor model:
 *   mu(t,T) = sigma1^2 * tau + sigma2 * sigma1 * rho * tau^2 / 2
 *
 * where tau = T - t (time to maturity).
 *
 * Returns precomputed drift for each tenor to avoid repeated integration.
 */
export function computeDriftCorrection(
  params: HJMParams,
  tenors: number[],
  currentTime: number,
): number[] {
  return tenors.map((T) => {
    const tau = T - currentTime;
    if (tau <= 0) return 0;

    const term1 = params.sigma1 ** 2 * tau;
    const term2 = (params.sigma2 * params.sigma1 * params.rho * tau ** 2) / 2;
    return term1 + term2;
  });
}

// ─── Linear Algebra Helpers (no external dependency) ─────────────

/**
 * Power iteration to find the dominant eigenvalue/eigenvector of a symmetric matrix.
 * Convergence threshold: 1e-10 (sufficient for financial calibration).
 * Max iterations: 500 (convergence typically in <50 for well-conditioned covariance).
 */
function powerIteration(
  matrix: number[][],
  n: number,
): { eigenvalue: number; eigenvector: number[] } {
  let vec = new Array(n).fill(0);
  // Initialize with [1, 0, 0, ...] for determinism
  vec[0] = 1;

  let eigenvalue = 0;
  const MAX_ITER = 500;
  const TOL = 1e-10;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Matrix-vector multiply
    const newVec = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        newVec[i] += matrix[i][j] * vec[j];
      }
    }

    // Compute norm
    let norm = 0;
    for (let i = 0; i < n; i++) norm += newVec[i] ** 2;
    norm = Math.sqrt(norm);

    if (norm < 1e-15) {
      // Zero matrix or converged to zero
      return { eigenvalue: 0, eigenvector: new Array(n).fill(0) };
    }

    // Normalize
    const prevEigenvalue = eigenvalue;
    eigenvalue = norm;
    for (let i = 0; i < n; i++) newVec[i] /= norm;

    // Check convergence
    if (Math.abs(eigenvalue - prevEigenvalue) < TOL * Math.abs(eigenvalue)) {
      return { eigenvalue, eigenvector: newVec };
    }

    vec = newVec;
  }

  return { eigenvalue, eigenvector: vec };
}

/**
 * Deflate a symmetric matrix by removing the contribution of a known eigenpair.
 * A' = A - lambda * v * v^T
 */
function deflateMatrix(
  matrix: number[][],
  eigenvalue: number,
  eigenvector: number[],
  n: number,
): number[][] {
  const result: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i][j] =
        matrix[i][j] - eigenvalue * eigenvector[i] * eigenvector[j];
    }
  }

  return result;
}
