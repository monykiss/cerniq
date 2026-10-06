// ─── HJM Two-Factor Monte Carlo Service ─────────────────────────
//
// NestJS Injectable service for HJM forward-curve Monte Carlo simulation.
// Wraps the pure-function engine in hjm/monte-carlo.ts.
//
// Per-path evolution:
//   1. Generate correlated Brownian increments via Cholesky:
//      L = [[1, 0], [rho, sqrt(1-rho^2)]]
//   2. Evolve forward curve:
//      f(t+dt, T) = f(t,T) + drift*dt + sigma1*dW1 + sigma2*(T-t)*dW2
//   3. HJM drift correction (no-arbitrage):
//      mu(t,T) = sigma1^2*(T-t) + sigma2*sigma1*rho*(T-t)^2/2
//   4. Compute NII by repricing assets/liabilities at evolved rates
//
// Uses seeded PRNG for reproducibility: same seed = same paths.

import { Injectable, Logger } from '@nestjs/common';
import { runHJMMonteCarlo } from './hjm/monte-carlo';
import { ForwardCurve } from './hjm/forward-curve';
import { HJMCalibrationService } from './hjm-calibration.service';
import {
  HJMMonteCarloInput,
  HJMMonteCarloResult,
  HJMParams,
  RepricingBucket,
  ForwardCurveSnapshot,
} from './hjm/types';

// ─── Types ──────────────────────────────────────────────────────

/** Simplified balance sheet summary for Monte Carlo input. */
export interface BalanceSheetSummary {
  repricingBuckets: RepricingBucket[];
}

/** Parameters for running HJM Monte Carlo. */
export interface HJMMonteCarloParams {
  forwardCurve: ForwardCurve;
  hjmParams: HJMParams;
  balanceSheet: BalanceSheetSummary;
  numPaths: number;
  seed: number;
  /** Number of daily time steps (default: 252 = 1 year). */
  numSteps?: number;
}

/** Maximum paths to prevent memory exhaustion. */
const MAX_PATHS = 50_000;
/** Default simulation horizon: 252 trading days = 1 year. */
const DEFAULT_STEPS = 252;

@Injectable()
export class HJMMonteCarloService {
  private readonly logger = new Logger(HJMMonteCarloService.name);

  constructor(private readonly calibrationService: HJMCalibrationService) {}

  /**
   * Run HJM two-factor Monte Carlo simulation.
   *
   * For each path:
   *   1. Correlated Brownian increments via Cholesky decomposition
   *   2. Evolve forward curve with HJM drift correction
   *   3. Reprice balance sheet at evolved rates
   *   4. Accumulate NII over the simulation horizon
   *
   * @returns { paths, niiDistribution, niiAtRisk95, niiAtRisk99, expectedNii, sigma }
   */
  runHJMMonteCarlo(params: HJMMonteCarloParams): HJMMonteCarloResult {
    const {
      forwardCurve,
      hjmParams,
      balanceSheet,
      numPaths,
      seed,
      numSteps = DEFAULT_STEPS,
    } = params;

    const clampedPaths = Math.min(Math.max(numPaths, 10), MAX_PATHS);

    this.logger.log(
      `HJM Monte Carlo: ${clampedPaths} paths x ${numSteps} steps, ` +
        `sigma1=${hjmParams.sigma1.toFixed(4)}, sigma2=${hjmParams.sigma2.toFixed(4)}, ` +
        `rho=${hjmParams.rho.toFixed(3)}, seed=${seed}`,
    );

    const snapshot = forwardCurve.toSnapshot();

    const input: HJMMonteCarloInput = {
      forwardCurve: snapshot,
      hjmParams,
      repricingBuckets: balanceSheet.repricingBuckets,
      numPaths: clampedPaths,
      numSteps,
      seed,
    };

    const result = runHJMMonteCarlo(input);

    this.logger.log(
      `HJM Monte Carlo complete: ` +
        `expectedNII=${result.expectedNII.toFixed(2)}, ` +
        `stdNII=${result.stdNII.toFixed(2)}, ` +
        `NII@Risk95=${result.niiAtRisk95.toFixed(2)}, ` +
        `NII@Risk99=${result.niiAtRisk99.toFixed(2)}, ` +
        `convergence=${result.convergenceMet}, ` +
        `${result.computeTimeMs}ms`,
    );

    return result;
  }

  /**
   * Run Monte Carlo with default calibration params and a ForwardCurve.
   *
   * Convenience method that pulls HJM params from the calibration service.
   */
  runWithDefaults(
    forwardCurve: ForwardCurve,
    balanceSheet: BalanceSheetSummary,
    opts?: { paths?: number; steps?: number; seed?: number },
  ): HJMMonteCarloResult {
    return this.runHJMMonteCarlo({
      forwardCurve,
      hjmParams: this.calibrationService.getParams(),
      balanceSheet,
      numPaths: opts?.paths ?? 500,
      numSteps: opts?.steps ?? DEFAULT_STEPS,
      seed: opts?.seed ?? 42,
    });
  }
}

// Re-export types for consumers
export type {
  HJMMonteCarloInput,
  HJMMonteCarloResult,
  RepricingBucket,
  ForwardCurveSnapshot,
} from './hjm/types';
export { runHJMMonteCarlo } from './hjm/monte-carlo';
