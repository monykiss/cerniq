import { DepositPricingEngineService } from './deposit-pricing-engine.service';

describe('DepositPricingEngineService', () => {
  let service: DepositPricingEngineService;

  const baseParams = {
    competitorRates: [0.04, 0.042, 0.038, 0.045, 0.041],
    costOfFunds: 0.05,
    targetSpread: 0.005,
    elasticity: 0.95,
    currentBalance: 10_000_000,
  };

  beforeEach(() => {
    service = new DepositPricingEngineService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('optimal rate should be positive', () => {
    const result = service.priceDeposit(baseParams);
    expect(result.optimalRate).toBeGreaterThan(0);
  });

  it('optimal rate should be less than or equal to cost of funds', () => {
    const result = service.priceDeposit(baseParams);
    expect(result.optimalRate).toBeLessThanOrEqual(baseParams.costOfFunds);
  });

  it('net interest margin should be positive when rate < COF', () => {
    const result = service.priceDeposit(baseParams);
    if (result.optimalRate < baseParams.costOfFunds) {
      expect(result.netInterestMargin).toBeGreaterThan(0);
    }
  });

  it('retention probability should be between 0 and 1', () => {
    const result = service.priceDeposit(baseParams);
    expect(result.retentionProbability).toBeGreaterThanOrEqual(0);
    expect(result.retentionProbability).toBeLessThanOrEqual(1);
  });

  it('projected balance should not exceed current balance', () => {
    const result = service.priceDeposit(baseParams);
    expect(result.projectedBalance).toBeLessThanOrEqual(
      baseParams.currentBalance,
    );
  });

  it('higher rate should produce higher retention', () => {
    const low = service.priceDeposit({ ...baseParams, targetSpread: 0.02 });
    const high = service.priceDeposit({ ...baseParams, targetSpread: 0.001 });
    expect(high.retentionProbability).toBeGreaterThanOrEqual(
      low.retentionProbability,
    );
  });

  it('rate sensitivity should return ordered results', () => {
    const results = service.rateSensitivity({
      competitorRates: baseParams.competitorRates,
      costOfFunds: baseParams.costOfFunds,
      currentBalance: baseParams.currentBalance,
      rateRange: { min: 0.03, max: 0.05, step: 0.005 },
    });
    expect(results.length).toBeGreaterThanOrEqual(3);
    // Higher rate => higher retention
    expect(results[results.length - 1].retentionProbability).toBeGreaterThan(
      results[0].retentionProbability,
    );
  });

  it('revenue maximizing rate should produce positive revenue', () => {
    const result = service.findRevenueMaximizingRate({
      competitorRates: baseParams.competitorRates,
      costOfFunds: baseParams.costOfFunds,
      currentBalance: baseParams.currentBalance,
    });
    expect(result.optimalRate).toBeGreaterThan(0);
    expect(result.maxNetRevenue).toBeGreaterThan(0);
  });
});
