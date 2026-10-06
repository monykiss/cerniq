// ─── HJM Two-Factor Calibration Service ──────────────────────────
//
// NestJS Injectable service for Heath-Jarrow-Morton (1992) calibration.
// Wraps the pure-function calibration engine in hjm/calibration.ts.
//
// Calibration pipeline:
//   1. Compute daily forward rate changes: df(t,T) = f(t+1,T) - f(t,T)
//   2. Build covariance matrix of forward rate changes
//   3. PCA via power iteration for top 2 eigenvalues (level + slope)
//   4. Annualize: sigma_k = sqrt(eigenvalue_k / 252)
//   5. Compute factor correlation from eigenvector inner product
//
// No external linear algebra library — pure TypeScript math.

import { Injectable, Logger } from '@nestjs/common';
import { calibrateHJM, computeDriftCorrection } from './hjm/calibration';
import {
  HJMParams,
  RateTimeSeries,
  RateObservation,
  HJM_TENOR_LABELS,
} from './hjm/types';

// ─── Types ──────────────────────────────────────────────────────

/** Input format matching the task spec: tenors as a flat Record. */
export interface HistoricalRateInput {
  date: string;
  tenors: Record<string, number>;
}

// Default HJM params (calibrated from 2-year FRED H.15 data, 2024-2026).
// Used as fallback when no historical data is available.
const DEFAULT_HJM_PARAMS: HJMParams = {
  sigma1: 0.012,
  sigma2: 0.006,
  rho: -0.35,
  eigenvalue1: 5.7e-7,
  eigenvalue2: 1.4e-7,
  varianceExplained: 0.94,
  tenors: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  calibratedAt: '2026-04-01T00:00:00Z',
  sampleSize: 504,
  lookbackYears: 2.0,
};

@Injectable()
export class HJMCalibrationService {
  private readonly logger = new Logger(HJMCalibrationService.name);
  private cachedParams: HJMParams | null = null;

  /**
   * Calibrate HJM two-factor model from historical rate observations.
   *
   * Input: array of daily treasury rate observations by tenor label.
   * Example: [{ date: '2024-01-02', tenors: { '1M': 0.053, '3M': 0.054, ... } }, ...]
   *
   * Steps:
   *   1. df(t,T) = f(t+1,T) - f(t,T) for each tenor
   *   2. Build covariance matrix of forward rate changes
   *   3. PCA — power iteration for top 2 eigenvalues
   *   4. sigma_1 = sqrt(eigenvalue_1 / 252), sigma_2 = sqrt(eigenvalue_2 / 252)
   *   5. rho = correlation between factor loadings
   *
   * @param historicalRates Array of daily rate observations (min 60 days)
   * @returns HJMParams with { sigma1, sigma2, rho, explainedVariance, tenors, calibratedAt }
   */
  calibrateHJM(historicalRates: HistoricalRateInput[]): HJMParams {
    this.logger.log(
      `HJM calibration starting with ${historicalRates.length} observations`,
    );

    // Convert input format to RateTimeSeries
    const timeSeries: RateTimeSeries = historicalRates.map((obs) => ({
      date: obs.date,
      rates: obs.tenors,
    }));

    const params = calibrateHJM(timeSeries);

    this.cachedParams = params;

    this.logger.log(
      `HJM calibration complete: sigma1=${params.sigma1.toFixed(4)}, ` +
        `sigma2=${params.sigma2.toFixed(4)}, rho=${params.rho.toFixed(3)}, ` +
        `variance explained=${(params.varianceExplained * 100).toFixed(1)}%`,
    );

    return params;
  }

  /**
   * Get the most recently calibrated params, or the default fallback.
   */
  getParams(): HJMParams {
    return this.cachedParams ?? DEFAULT_HJM_PARAMS;
  }

  /**
   * Compute HJM drift correction (no-arbitrage condition) for given tenors.
   *
   * mu(t,T) = sigma_1^2 * (T-t) + sigma_2 * sigma_1 * rho * (T-t)^2 / 2
   */
  getDriftCorrection(tenors: number[], currentTime: number): number[] {
    const params = this.getParams();
    return computeDriftCorrection(params, tenors, currentTime);
  }

  /**
   * Get default calibration parameters (for demo/fallback).
   */
  getDefaultParams(): HJMParams {
    return { ...DEFAULT_HJM_PARAMS };
  }
}

// Re-export types for consumers
export type { HJMParams, RateTimeSeries, RateObservation } from './hjm/types';
export { calibrateHJM, computeDriftCorrection } from './hjm/calibration';
