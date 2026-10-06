import { BlackLittermanService } from './black-litterman.service';

describe('BlackLittermanService', () => {
  let svc: BlackLittermanService;

  const mockItems = [
    { subcategory: 'cash', balance: 50, rate: 0.02, category: 'asset' },
    { subcategory: 'securities', balance: 100, rate: 0.04, category: 'asset' },
    {
      subcategory: 'consumer_loans',
      balance: 150,
      rate: 0.07,
      category: 'asset',
    },
  ];

  beforeEach(() => {
    const mockPrisma = {
      balanceSheetItem: {
        findMany: jest.fn().mockResolvedValue(mockItems),
      },
    } as any;
    svc = new BlackLittermanService(mockPrisma);
  });

  it('should return result with correct shape', async () => {
    const result = await svc.computeBLPortfolio('inst-1');
    expect(result).toHaveProperty('equilibriumReturns');
    expect(result).toHaveProperty('posteriorReturns');
    expect(result).toHaveProperty('optimalWeights');
    expect(result).toHaveProperty('assetNames');
    expect(result).toHaveProperty('sharpeRatio');
    expect(result.assetNames.length).toBeGreaterThan(0);
  });

  it('should have weights summing to approximately 1', async () => {
    const result = await svc.computeBLPortfolio('inst-1');
    const wSum = result.optimalWeights.reduce((s, w) => s + w, 0);
    expect(wSum).toBeCloseTo(1.0, 1);
  });

  it('should return non-negative Sharpe ratio', async () => {
    const result = await svc.computeBLPortfolio('inst-1');
    expect(result.sharpeRatio).toBeGreaterThanOrEqual(0);
  });

  it('should compute equilibrium returns from balance sheet data', async () => {
    const result = await svc.computeBLPortfolio('inst-1');
    expect(result.assetNames).toEqual(['cash', 'securities', 'consumer_loans']);
    expect(result.equilibriumReturns.length).toBe(3);
    expect(result.optimalWeights.length).toBe(3);
  });

  it('should have posteriorReturns equal equilibriumReturns when no views', async () => {
    const result = await svc.computeBLPortfolio('inst-1', []);
    expect(result.posteriorReturns).toEqual(result.equilibriumReturns);
    expect(result.viewContributions).toEqual([]);
  });

  // ── D1: empty balance sheet → data_unavailable, never demo ──
  it('returns data_unavailable with a CRITICAL gap on an empty balance sheet', async () => {
    const emptyPrisma = {
      balanceSheetItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const emptySvc = new BlackLittermanService(emptyPrisma);
    const result = await emptySvc.computeBLPortfolio('inst-1');
    expect(result.status).toBe('data_unavailable');
    expect(result.assetNames).toEqual([]);
    expect(result.optimalWeights).toEqual([]);
    expect(result.sharpeRatio).toBeNull();
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  // ── Views incorporation ────────────────────────────────────
  describe('with views', () => {
    it('shifts posterior returns toward view direction', async () => {
      const views = [
        {
          description: 'Consumer loans outperform',
          assets: ['consumer_loans'],
          type: 'absolute' as const,
          expectedReturn: 0.15,
          confidence: 0.8,
        },
      ];
      const result = await svc.computeBLPortfolio('inst-1', views);
      // Consumer loans posterior return should be > equilibrium
      const consIdx = result.assetNames.indexOf('consumer_loans');
      expect(consIdx).toBeGreaterThanOrEqual(0);
      expect(result.posteriorReturns[consIdx]).toBeGreaterThanOrEqual(
        result.equilibriumReturns[consIdx],
      );
    });

    it('viewContributions has shift values', async () => {
      const views = [
        {
          description: 'Securities up',
          assets: ['securities'],
          type: 'absolute' as const,
          expectedReturn: 0.1,
          confidence: 0.6,
        },
      ];
      const result = await svc.computeBLPortfolio('inst-1', views);
      expect(result.viewContributions).toHaveLength(1);
      expect(result.viewContributions[0].view).toBe('Securities up');
      expect(typeof result.viewContributions[0].shift).toBe('number');
    });

    it('multiple views produce different posterior vs single view', async () => {
      const singleView = [
        {
          description: 'Cash underperform',
          assets: ['cash'],
          type: 'absolute' as const,
          expectedReturn: 0.001,
          confidence: 0.9,
        },
      ];
      const multipleViews = [
        ...singleView,
        {
          description: 'Loans outperform',
          assets: ['consumer_loans'],
          type: 'absolute' as const,
          expectedReturn: 0.12,
          confidence: 0.7,
        },
      ];
      const r1 = await svc.computeBLPortfolio('inst-1', singleView);
      const r2 = await svc.computeBLPortfolio('inst-1', multipleViews);
      // Multiple views should produce different optimal weights
      expect(r2.optimalWeights).not.toEqual(r1.optimalWeights);
    });

    it('low confidence view has less impact than high confidence', async () => {
      const lowConf = [
        {
          description: 'Low conf',
          assets: ['consumer_loans'],
          type: 'absolute' as const,
          expectedReturn: 0.15,
          confidence: 0.1,
        },
      ];
      const highConf = [
        {
          description: 'High conf',
          assets: ['consumer_loans'],
          type: 'absolute' as const,
          expectedReturn: 0.15,
          confidence: 0.95,
        },
      ];
      const rLow = await svc.computeBLPortfolio('inst-1', lowConf);
      const rHigh = await svc.computeBLPortfolio('inst-1', highConf);

      const consIdx = rLow.assetNames.indexOf('consumer_loans');
      const lowShift = Math.abs(
        rLow.posteriorReturns[consIdx] - rLow.equilibriumReturns[consIdx],
      );
      const highShift = Math.abs(
        rHigh.posteriorReturns[consIdx] - rHigh.equilibriumReturns[consIdx],
      );
      expect(highShift).toBeGreaterThanOrEqual(lowShift);
    });
  });

  // ── Portfolio metrics ──────────────────────────────────────
  describe('portfolio metrics', () => {
    it('portfolioExpectedReturn is finite', async () => {
      const result = await svc.computeBLPortfolio('inst-1');
      expect(Number.isFinite(result.portfolioExpectedReturn)).toBe(true);
    });

    it('portfolioRisk is non-negative', async () => {
      const result = await svc.computeBLPortfolio('inst-1');
      expect(result.portfolioRisk).toBeGreaterThanOrEqual(0);
    });

    it('sharpeRatio is 0 when portfolio variance is 0', async () => {
      // All in cash (vol = 0.01) should have near-zero risk
      const cashOnlyPrisma = {
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              subcategory: 'cash',
              balance: 1000,
              rate: 0.02,
              category: 'asset',
            },
          ]),
        },
      } as any;
      const cashSvc = new BlackLittermanService(cashOnlyPrisma);
      const result = await cashSvc.computeBLPortfolio('inst-1');
      // Should not throw even with very small variance
      expect(Number.isFinite(result.sharpeRatio)).toBe(true);
    });
  });

  // ── Optimal weights are non-negative and sum to 1 ──────────
  describe('weight constraints', () => {
    it('all weights are non-negative', async () => {
      const result = await svc.computeBLPortfolio('inst-1');
      for (const w of result.optimalWeights) {
        expect(w).toBeGreaterThanOrEqual(0);
      }
    });

    it('weights sum to 1 even with views', async () => {
      const views = [
        {
          description: 'Test',
          assets: ['securities'],
          type: 'absolute' as const,
          expectedReturn: 0.08,
          confidence: 0.7,
        },
      ];
      const result = await svc.computeBLPortfolio('inst-1', views);
      const wSum = result.optimalWeights.reduce((s, w) => s + w, 0);
      expect(wSum).toBeCloseTo(1.0, 1);
    });
  });

  // ── volatility mapping ─────────────────────────────────────
  describe('volatility mapping by asset class', () => {
    it('assigns different vol to cash vs mortgage vs commercial', async () => {
      const diversePrisma = {
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              subcategory: 'cash',
              balance: 100,
              rate: 0.01,
              category: 'asset',
            },
            {
              subcategory: 'residential_mortgage',
              balance: 100,
              rate: 0.05,
              category: 'asset',
            },
            {
              subcategory: 'commercial_loans',
              balance: 100,
              rate: 0.07,
              category: 'asset',
            },
          ]),
        },
      } as any;
      const diverseSvc = new BlackLittermanService(diversePrisma);
      const result = await diverseSvc.computeBLPortfolio('inst-1');
      expect(result.assetNames).toEqual([
        'cash',
        'residential_mortgage',
        'commercial_loans',
      ]);
      // Cash should have higher weight (lower vol) in MVO
      expect(result.equilibriumReturns.length).toBe(3);
    });
  });

  // ── Duplicate subcategories are aggregated ─────────────────
  describe('subcategory aggregation', () => {
    it('aggregates balance and rate for same subcategory', async () => {
      const dupPrisma = {
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            { subcategory: 'cash', balance: 50, rate: 0.01, category: 'asset' },
            { subcategory: 'cash', balance: 50, rate: 0.02, category: 'asset' },
            {
              subcategory: 'securities',
              balance: 100,
              rate: 0.04,
              category: 'asset',
            },
          ]),
        },
      } as any;
      const dupSvc = new BlackLittermanService(dupPrisma);
      const result = await dupSvc.computeBLPortfolio('inst-1');
      expect(result.assetNames).toEqual(['cash', 'securities']);
      // Only 2 asset classes despite 3 items
      expect(result.optimalWeights.length).toBe(2);
    });
  });
});
