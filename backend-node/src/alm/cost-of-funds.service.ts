import { Injectable, Logger } from '@nestjs/common';

/**
 * Cost of Funds Calculator — Quant Model
 *
 * Computes the Weighted Average Cost of Funds (WACOF) across all
 * funding sources, segmented by type.
 *
 * WACOF = Σ(Balance_i × Rate_i) / Σ(Balance_i)
 *
 * Also computes:
 *   Marginal COF: Cost of the next dollar of funding (highest-cost source)
 *   By-type breakdown: Weighted rate for each funding category
 *     (e.g. deposits, borrowings, capital markets, equity)
 */

export interface FundingSource {
  name: string;
  balance: number;
  rate: number;
  type: string;
}

export interface FundingTypeBreakdown {
  type: string;
  totalBalance: number;
  weightedRate: number;
  pctOfTotal: number;
  sourceCount: number;
}

export interface CostOfFundsResult {
  weightedAvgCOF: number;
  marginalCOF: number;
  totalFunding: number;
  totalInterestCost: number;
  byType: FundingTypeBreakdown[];
}

@Injectable()
export class CostOfFundsService {
  private readonly logger = new Logger(CostOfFundsService.name);

  /**
   * Calculate weighted average cost of funds.
   *
   * @param params.fundingSources - Array of funding sources with balance, rate, type
   * @returns Weighted average COF, marginal COF, and breakdown by type
   */
  calculateCostOfFunds(params: {
    fundingSources: FundingSource[];
  }): CostOfFundsResult {
    const { fundingSources } = params;

    this.logger.log(
      `Computing cost of funds for ${fundingSources.length} sources`,
    );

    // Total funding and weighted cost
    let totalFunding = 0;
    let totalInterestCost = 0;
    let maxRate = 0;

    for (const source of fundingSources) {
      totalFunding += Number(source.balance);
      totalInterestCost += source.balance * source.rate;
      if (source.rate > maxRate) {
        maxRate = source.rate;
      }
    }

    const weightedAvgCOF =
      totalFunding > 0 ? totalInterestCost / totalFunding : 0;

    // Marginal COF: cost of the most expensive available funding
    const marginalCOF = maxRate;

    // Group by type
    const typeMap = new Map<
      string,
      { totalBalance: number; totalInterest: number; count: number }
    >();
    for (const source of fundingSources) {
      if (!typeMap.has(source.type)) {
        typeMap.set(source.type, {
          totalBalance: 0,
          totalInterest: 0,
          count: 0,
        });
      }
      const entry = typeMap.get(source.type)!;
      entry.totalBalance += Number(source.balance);
      entry.totalInterest += source.balance * source.rate;
      entry.count++;
    }

    const byType: FundingTypeBreakdown[] = [];
    for (const [type, data] of typeMap) {
      byType.push({
        type,
        totalBalance: +data.totalBalance.toFixed(2),
        weightedRate:
          data.totalBalance > 0
            ? +(data.totalInterest / data.totalBalance).toFixed(6)
            : 0,
        pctOfTotal:
          totalFunding > 0
            ? +((data.totalBalance / totalFunding) * 100).toFixed(2)
            : 0,
        sourceCount: data.count,
      });
    }

    // Sort by balance descending
    byType.sort((a, b) => b.totalBalance - a.totalBalance);

    return {
      weightedAvgCOF: +weightedAvgCOF.toFixed(6),
      marginalCOF: +marginalCOF.toFixed(6),
      totalFunding: +totalFunding.toFixed(2),
      totalInterestCost: +totalInterestCost.toFixed(2),
      byType,
    };
  }

  /**
   * Compute the impact of adding a new funding source on WACOF.
   */
  computeFundingImpact(params: {
    existingSources: FundingSource[];
    newSource: FundingSource;
  }): {
    beforeCOF: number;
    afterCOF: number;
    change: number;
    changeBps: number;
  } {
    const before = this.calculateCostOfFunds({
      fundingSources: params.existingSources,
    });
    const after = this.calculateCostOfFunds({
      fundingSources: [...params.existingSources, params.newSource],
    });

    const change = after.weightedAvgCOF - before.weightedAvgCOF;

    return {
      beforeCOF: before.weightedAvgCOF,
      afterCOF: after.weightedAvgCOF,
      change: +change.toFixed(6),
      changeBps: +(change * 10000).toFixed(1),
    };
  }

  /**
   * Optimize funding mix to minimize WACOF given constraints.
   * Sorts sources by rate and allocates from cheapest to most expensive.
   */
  optimizeFundingMix(params: {
    availableSources: Array<FundingSource & { maxCapacity: number }>;
    targetFunding: number;
  }): {
    allocations: Array<{ name: string; allocated: number; rate: number }>;
    achievedCOF: number;
    shortfall: number;
  } {
    const { availableSources, targetFunding } = params;

    // Sort by rate ascending (cheapest first)
    const sorted = [...availableSources].sort((a, b) => a.rate - b.rate);

    let remaining = targetFunding;
    let totalInterest = 0;
    let totalAllocated = 0;
    const allocations: Array<{
      name: string;
      allocated: number;
      rate: number;
    }> = [];

    for (const source of sorted) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, source.maxCapacity);
      allocations.push({
        name: source.name,
        allocated: +allocated.toFixed(2),
        rate: source.rate,
      });
      totalInterest += allocated * source.rate;
      totalAllocated += allocated;
      remaining -= allocated;
    }

    const achievedCOF = totalAllocated > 0 ? totalInterest / totalAllocated : 0;

    return {
      allocations,
      achievedCOF: +achievedCOF.toFixed(6),
      shortfall: +Math.max(0, remaining).toFixed(2),
    };
  }
}
