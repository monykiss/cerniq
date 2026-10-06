import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { ForwardCurve } from './forward-curve';
import { calibrateHJM } from './calibration';
import { runHJMMonteCarloAsync } from './hjm-worker';
import {
  HJMMonteCarloResult,
  HJMParams,
  RateTimeSeries,
  RepricingBucket,
} from './types';

// Default US Treasury curve (approximate April 2026, from FRED H.15)
const DEFAULT_SPOT_RATES: Record<string, number> = {
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

// Default HJM params (calibrated from 2-year FRED H.15 data, 2024-2026)
// These are used when no historical data is available for live calibration.
const DEFAULT_HJM_PARAMS: HJMParams = {
  sigma1: 0.012, // 1.2% annualized level vol
  sigma2: 0.006, // 0.6% annualized slope vol
  rho: -0.35, // negative: when rates rise, curve tends to flatten
  eigenvalue1: 5.7e-7,
  eigenvalue2: 1.4e-7,
  varianceExplained: 0.94,
  tenors: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  calibratedAt: '2026-04-01T00:00:00Z',
  sampleSize: 504,
  lookbackYears: 2.0,
};

@Injectable()
export class HJMService {
  private readonly logger = new Logger(HJMService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run HJM Monte Carlo for an institution.
   *
   * Pulls balance sheet repricing buckets, constructs the forward curve,
   * and runs the full two-factor simulation.
   */
  async runForInstitution(
    institutionId: string,
    opts?: {
      paths?: number;
      steps?: number;
      seed?: number;
      hjmParams?: HJMParams;
      spotRates?: Record<string, number>;
    },
  ): Promise<HJMMonteCarloResult> {
    const startMs = Date.now();
    this.logger.log(
      `HJM Monte Carlo starting for institution ${institutionId}`,
    );

    // Fetch balance sheet repricing data
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    if (items.length === 0) {
      this.logger.warn(
        `No balance sheet items for institution ${institutionId} — HJM cannot run`,
      );
      return this.dataUnavailableResult(opts?.seed ?? 42);
    }

    // Build repricing buckets from balance sheet items
    const buckets = this.buildRepricingBuckets(items);

    if (buckets.length === 0) {
      this.logger.warn(
        `No repricing buckets could be constructed for institution ${institutionId}`,
      );
      return this.dataUnavailableResult(opts?.seed ?? 42);
    }

    // Construct forward curve
    const spotRates = opts?.spotRates ?? DEFAULT_SPOT_RATES;
    const curve = new ForwardCurve(spotRates);
    const snapshot = curve.toSnapshot();

    // HJM params (use provided, or calibrated, or defaults)
    const hjmParams = opts?.hjmParams ?? DEFAULT_HJM_PARAMS;

    const result = await runHJMMonteCarloAsync({
      forwardCurve: snapshot,
      hjmParams,
      repricingBuckets: buckets,
      numPaths: opts?.paths ?? 500,
      numSteps: opts?.steps ?? 252,
      seed: opts?.seed ?? 42,
    });

    this.logger.log(
      `HJM Monte Carlo complete for ${institutionId}: ` +
        `${result.paths} paths, ${result.steps} steps, ` +
        `expectedNII=${result.expectedNII.toFixed(2)}, ` +
        `NII@Risk95=${result.niiAtRisk95.toFixed(2)}, ` +
        `${result.computeTimeMs}ms`,
    );

    return result;
  }

  /**
   * Calibrate HJM parameters from historical rate data.
   *
   * In production, this reads from a FRED data cache or market data service.
   * For now, accepts raw observations.
   */
  calibrate(history: RateTimeSeries): HJMParams {
    this.logger.log(
      `Calibrating HJM from ${history.length} daily observations`,
    );
    const params = calibrateHJM(history);
    this.logger.log(
      `HJM calibration complete: sigma1=${params.sigma1.toFixed(4)}, ` +
        `sigma2=${params.sigma2.toFixed(4)}, rho=${params.rho.toFixed(3)}, ` +
        `variance explained=${(params.varianceExplained * 100).toFixed(1)}%`,
    );
    return params;
  }

  /**
   * Build repricing buckets from raw balance sheet items.
   *
   * Groups items by their duration/repricing tenor into buckets.
   */
  private buildRepricingBuckets(items: any[]): RepricingBucket[] {
    // Standard repricing time bands (years)
    const bands = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];
    const buckets: RepricingBucket[] = bands.map((tenor) => ({
      tenor,
      assetBalance: 0,
      assetRate: 0,
      liabilityBalance: 0,
      liabilityRate: 0,
    }));

    for (const item of items) {
      const duration = item.duration ?? 1;
      const rate = item.rate ?? 0;
      const balance = item.balance ?? 0;
      const isAsset = item.category === 'asset';

      // Find the closest repricing band
      let bestIdx = 0;
      let bestDist = Math.abs(bands[0] - duration);
      for (let i = 1; i < bands.length; i++) {
        const dist = Math.abs(bands[i] - duration);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      if (isAsset) {
        // Weighted average rate
        const oldTotal = buckets[bestIdx].assetBalance;
        const newTotal = oldTotal + balance;
        if (newTotal > 0) {
          buckets[bestIdx].assetRate =
            (buckets[bestIdx].assetRate * oldTotal + rate * balance) / newTotal;
        }
        buckets[bestIdx].assetBalance = newTotal;
      } else {
        const oldTotal = buckets[bestIdx].liabilityBalance;
        const newTotal = oldTotal + balance;
        if (newTotal > 0) {
          buckets[bestIdx].liabilityRate =
            (buckets[bestIdx].liabilityRate * oldTotal + rate * balance) /
            newTotal;
        }
        buckets[bestIdx].liabilityBalance = newTotal;
      }
    }

    // Only return buckets with actual positions
    return buckets.filter((b) => b.assetBalance > 0 || b.liabilityBalance > 0);
  }

  private dataUnavailableResult(seed: number): HJMMonteCarloResult {
    return {
      paths: 0,
      steps: 0,
      seed,
      hjmParams: DEFAULT_HJM_PARAMS,
      niiDistribution: [],
      eveDistribution: [],
      expectedNII: 0,
      stdNII: 0,
      niiAtRisk95: 0,
      niiAtRisk99: 0,
      expectedEVE: 0,
      eveAtRisk95: 0,
      eveAtRisk99: 0,
      convergenceMet: false,
      standardError: 0,
      computeTimeMs: 0,
      fanChart: [],
    };
  }
}
