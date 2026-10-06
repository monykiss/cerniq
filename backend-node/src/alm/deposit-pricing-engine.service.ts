import { Injectable, Logger } from '@nestjs/common';

/**
 * Deposit Pricing Engine — Quant Model
 *
 * Determines the optimal deposit rate that balances customer retention
 * against funding cost efficiency.
 *
 * Optimal Rate = max(COF - TargetSpread, CompetitorAvg × Elasticity)
 *
 * Where:
 *   COF           = Cost of alternative funding
 *   TargetSpread  = Desired margin between funding cost and deposit rate
 *   CompetitorAvg = Average competitor deposit rate
 *   Elasticity    = Price sensitivity factor (0-1, how much rate affects retention)
 *
 * Retention Model:
 *   RetentionProb = 1 / (1 + exp(-k × (offeredRate - competitorAvg)))
 *   where k = elasticity scaling factor
 *
 * Net Interest Margin = COF - OfferedRate (from institution's perspective)
 */

export interface DepositPricingResult {
  optimalRate: number;
  projectedBalance: number;
  netInterestMargin: number;
  retentionProbability: number;
  competitorAvg: number;
  rateVsCompetitor: number;
}

@Injectable()
export class DepositPricingEngineService {
  private readonly logger = new Logger(DepositPricingEngineService.name);

  /**
   * Price a deposit product optimally.
   *
   * @param params.competitorRates - Array of competitor deposit rates
   * @param params.costOfFunds - Alternative cost of funds (decimal)
   * @param params.targetSpread - Desired spread below COF (decimal)
   * @param params.elasticity - Customer price elasticity (0 to 1)
   * @param params.currentBalance - Current deposit balance
   * @returns Optimal rate, projected balance, NIM, retention probability
   */
  priceDeposit(params: {
    competitorRates: number[];
    costOfFunds: number;
    targetSpread: number;
    elasticity: number;
    currentBalance: number;
  }): DepositPricingResult {
    const {
      competitorRates,
      costOfFunds,
      targetSpread,
      elasticity,
      currentBalance,
    } = params;

    this.logger.log(
      `Pricing deposit: COF=${(costOfFunds * 100).toFixed(2)}%, balance=${currentBalance}`,
    );

    // Competitor average
    const competitorAvg =
      competitorRates.length > 0
        ? competitorRates.reduce((s, r) => s + r, 0) / competitorRates.length
        : 0;

    // Two pricing anchors
    const costBasedRate = costOfFunds - targetSpread;
    const competitorBasedRate = competitorAvg * elasticity;

    // Optimal rate: higher of cost-based and competitor-based
    const optimalRate = Math.max(costBasedRate, competitorBasedRate);

    // Retention probability (logistic model)
    const k = 100; // Elasticity scaling factor
    const retentionProbability =
      1 / (1 + Math.exp(-k * (optimalRate - competitorAvg)));

    // Projected balance based on retention
    const projectedBalance = currentBalance * retentionProbability;

    // Net interest margin: what the institution earns on these funds
    const netInterestMargin = costOfFunds - optimalRate;

    // Rate vs competitor
    const rateVsCompetitor = optimalRate - competitorAvg;

    return {
      optimalRate: +optimalRate.toFixed(6),
      projectedBalance: +projectedBalance.toFixed(2),
      netInterestMargin: +netInterestMargin.toFixed(6),
      retentionProbability: +retentionProbability.toFixed(4),
      competitorAvg: +competitorAvg.toFixed(6),
      rateVsCompetitor: +rateVsCompetitor.toFixed(6),
    };
  }

  /**
   * Sensitivity analysis: compute pricing at multiple rate levels.
   */
  rateSensitivity(params: {
    competitorRates: number[];
    costOfFunds: number;
    currentBalance: number;
    rateRange: { min: number; max: number; step: number };
  }): Array<{
    rate: number;
    retentionProbability: number;
    projectedBalance: number;
    nim: number;
    netRevenue: number;
  }> {
    const { competitorRates, costOfFunds, currentBalance, rateRange } = params;
    const competitorAvg =
      competitorRates.reduce((s, r) => s + r, 0) / competitorRates.length;
    const k = 100;

    const results: Array<{
      rate: number;
      retentionProbability: number;
      projectedBalance: number;
      nim: number;
      netRevenue: number;
    }> = [];

    for (
      let rate = rateRange.min;
      rate <= rateRange.max;
      rate += rateRange.step
    ) {
      const retention = 1 / (1 + Math.exp(-k * (rate - competitorAvg)));
      const projBalance = currentBalance * retention;
      const nim = costOfFunds - rate;
      const netRevenue = projBalance * nim;

      results.push({
        rate: +rate.toFixed(4),
        retentionProbability: +retention.toFixed(4),
        projectedBalance: +projBalance.toFixed(2),
        nim: +nim.toFixed(6),
        netRevenue: +netRevenue.toFixed(2),
      });
    }

    return results;
  }

  /**
   * Find the rate that maximizes net revenue (balance x NIM).
   */
  findRevenueMaximizingRate(params: {
    competitorRates: number[];
    costOfFunds: number;
    currentBalance: number;
  }): { optimalRate: number; maxNetRevenue: number } {
    const { competitorRates, costOfFunds, currentBalance } = params;
    const competitorAvg =
      competitorRates.reduce((s, r) => s + r, 0) / competitorRates.length;
    const k = 100;

    let bestRate = 0;
    let maxRevenue = -Infinity;

    // Search over rate range in fine steps
    for (let rate = 0; rate <= costOfFunds; rate += 0.0001) {
      const retention = 1 / (1 + Math.exp(-k * (rate - competitorAvg)));
      const projBalance = currentBalance * retention;
      const nim = costOfFunds - rate;
      const revenue = projBalance * nim;

      if (revenue > maxRevenue) {
        maxRevenue = revenue;
        bestRate = rate;
      }
    }

    return {
      optimalRate: +bestRate.toFixed(4),
      maxNetRevenue: +maxRevenue.toFixed(2),
    };
  }
}
