import { CostOfFundsService } from './cost-of-funds.service';

describe('CostOfFundsService', () => {
  let service: CostOfFundsService;

  const fundingSources = [
    { name: 'Savings', balance: 30_000_000, rate: 0.02, type: 'deposits' },
    { name: 'CDs', balance: 20_000_000, rate: 0.045, type: 'deposits' },
    { name: 'Checking', balance: 25_000_000, rate: 0.005, type: 'deposits' },
    {
      name: 'FHLB Advance',
      balance: 15_000_000,
      rate: 0.05,
      type: 'borrowings',
    },
    {
      name: 'Subordinated Debt',
      balance: 5_000_000,
      rate: 0.065,
      type: 'capital_markets',
    },
  ];

  beforeEach(() => {
    service = new CostOfFundsService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('WACOF should be between min and max source rates', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    const rates = fundingSources.map((s) => s.rate);
    expect(result.weightedAvgCOF).toBeGreaterThanOrEqual(Math.min(...rates));
    expect(result.weightedAvgCOF).toBeLessThanOrEqual(Math.max(...rates));
  });

  it('total funding should equal sum of balances', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    const expected = fundingSources.reduce((s, f) => s + f.balance, 0);
    expect(result.totalFunding).toBeCloseTo(expected, 0);
  });

  it('marginal COF should be the highest rate', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    expect(result.marginalCOF).toBe(0.065);
  });

  it('by-type breakdown should sum to total funding', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    const typeTotal = result.byType.reduce((s, t) => s + t.totalBalance, 0);
    expect(typeTotal).toBeCloseTo(result.totalFunding, 0);
  });

  it('by-type percentages should sum to 100', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    const pctTotal = result.byType.reduce((s, t) => s + t.pctOfTotal, 0);
    expect(pctTotal).toBeCloseTo(100, 0);
  });

  it('deposits type should have the most balance', () => {
    const result = service.calculateCostOfFunds({ fundingSources });
    const deposits = result.byType.find((t) => t.type === 'deposits')!;
    expect(deposits.totalBalance).toBeGreaterThan(50_000_000);
    expect(deposits.sourceCount).toBe(3);
  });

  it('adding expensive source should increase WACOF', () => {
    const result = service.computeFundingImpact({
      existingSources: fundingSources,
      newSource: {
        name: 'Expensive',
        balance: 10_000_000,
        rate: 0.08,
        type: 'borrowings',
      },
    });
    expect(result.afterCOF).toBeGreaterThan(result.beforeCOF);
    expect(result.changeBps).toBeGreaterThan(0);
  });

  it('funding mix optimizer should allocate cheapest first', () => {
    const result = service.optimizeFundingMix({
      availableSources: [
        {
          name: 'Cheap',
          balance: 0,
          rate: 0.02,
          type: 'deposits',
          maxCapacity: 50_000_000,
        },
        {
          name: 'Medium',
          balance: 0,
          rate: 0.04,
          type: 'deposits',
          maxCapacity: 30_000_000,
        },
        {
          name: 'Expensive',
          balance: 0,
          rate: 0.06,
          type: 'borrowings',
          maxCapacity: 20_000_000,
        },
      ],
      targetFunding: 60_000_000,
    });
    expect(result.allocations[0].name).toBe('Cheap');
    expect(result.shortfall).toBe(0);
    expect(result.achievedCOF).toBeLessThan(0.04);
  });
});
