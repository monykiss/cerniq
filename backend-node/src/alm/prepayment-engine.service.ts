import { Injectable, Logger } from '@nestjs/common';

// ─── PR-Specific CPR Model ──────────────────────────────────

export interface CPRResult {
  rateIncentive: number; // mortgage rate - current market rate
  baseCPR: number; // annual CPR before adjustments
  seasonalAdj: number;
  ageRampAdj: number;
  loyaltyDiscount: number;
  burnoutAdj: number;
  disasterAdj: number;
  finalCPR: number; // annual CPR after all adjustments
  monthlySMM: number; // single monthly mortality
}

export interface CPRSensitivity {
  points: Array<{ rateIncentive: number; cpr: number }>;
  currentPoint: { rateIncentive: number; cpr: number };
}

// PR-specific seasonality factors (higher in Q1/Q4)
const PR_SEASONALITY = [
  1.0, 1.2, 1.1, 0.9, 0.8, 0.9, 0.9, 1.0, 1.0, 1.1, 1.1, 1.2,
];

@Injectable()
export class PrepaymentEngineService {
  private readonly logger = new Logger(PrepaymentEngineService.name);

  // ─── Compute PR-Specific CPR ──────────────────────────────

  computePRCPR(params: {
    mortgageRate: number;
    currentMarketRate: number;
    ageMonths: number;
    month?: number; // 1-12
    burnoutFactor?: number; // 0-1
    disasterOverride?: number; // 0=normal, 1=post-hurricane
  }): CPRResult {
    const { mortgageRate, currentMarketRate, ageMonths } = params;
    const month = params.month ?? new Date().getMonth() + 1;
    const burnoutFactor = params.burnoutFactor ?? 1.0;
    const disasterOverride = params.disasterOverride ?? 0;

    const rateIncentive = mortgageRate - currentMarketRate;

    // Base CPR from rate incentive (S-curve)
    // At +200bps incentive → ~20% CPR; at 0 incentive → ~2% CPR
    const baseCPR = 0.02 + 0.18 / (1 + Math.exp(-10 * (rateIncentive - 0.015)));

    // Seasonality (PR-specific: diaspora remittances in Q1/Q4)
    const seasonalAdj = PR_SEASONALITY[month - 1];

    // Age ramp-up: months 1-30 ramp from 0 to full speed
    const ageRampAdj = Math.min(1, ageMonths / 30);

    // PR cooperative member loyalty discount: 20% less likely to refi
    const loyaltyDiscount = 0.8;

    // Burnout: remaining pool is less rate-sensitive
    const burnoutAdj = burnoutFactor;

    // Disaster override: post-hurricane, 30% CPR spike
    const disasterAdj = 1 + 0.3 * disasterOverride;

    const finalCPR =
      baseCPR *
      seasonalAdj *
      ageRampAdj *
      loyaltyDiscount *
      burnoutAdj *
      disasterAdj;

    // SMM = 1 - (1 - CPR)^(1/12)
    const monthlySMM = 1 - Math.pow(1 - finalCPR, 1 / 12);

    return {
      rateIncentive,
      baseCPR: Math.round(baseCPR * 10000) / 10000,
      seasonalAdj,
      ageRampAdj: Math.round(ageRampAdj * 100) / 100,
      loyaltyDiscount,
      burnoutAdj,
      disasterAdj,
      finalCPR: Math.round(finalCPR * 10000) / 10000,
      monthlySMM: Math.round(monthlySMM * 10000) / 10000,
    };
  }

  // ─── CPR Sensitivity Curve ────────────────────────────────

  computeSensitivity(
    currentMortgageRate: number,
    currentMarketRate: number,
    ageMonths: number = 36,
  ): CPRSensitivity {
    const points: CPRSensitivity['points'] = [];

    // Sweep market rates from -200bps to +200bps around current
    for (let bps = -200; bps <= 200; bps += 25) {
      const marketRate = currentMarketRate + bps / 10000;
      const result = this.computePRCPR({
        mortgageRate: currentMortgageRate,
        currentMarketRate: marketRate,
        ageMonths,
      });
      points.push({
        rateIncentive:
          Math.round((currentMortgageRate - marketRate) * 10000) / 10000,
        cpr: result.finalCPR,
      });
    }

    const currentResult = this.computePRCPR({
      mortgageRate: currentMortgageRate,
      currentMarketRate,
      ageMonths,
    });

    return {
      points,
      currentPoint: {
        rateIncentive: currentResult.rateIncentive,
        cpr: currentResult.finalCPR,
      },
    };
  }

  // ─── National PSA Comparison ──────────────────────────────

  computeNationalPSACPR(psa: number, ageMonths: number): number {
    // PSA model: CPR ramps linearly from 0 to 6% over first 30 months
    const baseCPR = 0.06 * (psa / 100);
    const ramp = Math.min(1, ageMonths / 30);
    return baseCPR * ramp;
  }
}
