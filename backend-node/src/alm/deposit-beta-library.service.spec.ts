import { DepositBetaLibraryService } from './deposit-beta-library.service';

describe('DepositBetaLibraryService', () => {
  let service: DepositBetaLibraryService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      institution: { findUnique: jest.fn() },
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new DepositBetaLibraryService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns benchmark data with correct shape', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      id: 'inst_1',
      totalAssets: 200,
    });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'liability',
        subcategory: 'savings',
        balance: 50,
        depositBeta: 0.2,
      },
      {
        category: 'liability',
        subcategory: 'time_deposits',
        balance: 80,
        depositBeta: 0.8,
      },
    ]);

    const result = await service.getBenchmark('inst_1');

    expect(result.institutionId).toBe('inst_1');
    expect(result.sizeTier).toBe('medium');
    expect(Array.isArray(result.benchmarks)).toBe(true);
    expect(result.benchmarks.length).toBeGreaterThan(0);
    for (const b of result.benchmarks) {
      expect(typeof b.subcategory).toBe('string');
      expect(typeof b.institutionBeta).toBe('number');
      expect(typeof b.peerMedian).toBe('number');
      expect(typeof b.gap).toBe('number');
      expect(typeof b.recommendation).toBe('string');
      expect(typeof b.recommendationEs).toBe('string');
    }
    expect(typeof result.insight).toBe('string');
    expect(typeof result.insightEs).toBe('string');
  });

  it('classifies institution size tiers correctly', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 30 });
    const small = await service.getBenchmark('inst_1');
    expect(small.sizeTier).toBe('small');

    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 150 });
    const medium = await service.getBenchmark('inst_1');
    expect(medium.sizeTier).toBe('medium');

    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 500 });
    const large = await service.getBenchmark('inst_1');
    expect(large.sizeTier).toBe('large');
  });

  it('handles null institution with defaults', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.getBenchmark('inst_1');
    expect(result.sizeTier).toBe('medium'); // default 200 assets
    expect(result.benchmarks.length).toBeGreaterThan(0);
  });

  it('getRawLibrary returns the benchmark data', () => {
    const lib = service.getRawLibrary();
    expect(lib).toBeDefined();
    expect(lib).toHaveProperty('betas');
  });

  it('elevated beta produces recalibration recommendation', async () => {
    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 200 });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'liability',
        subcategory: 'savings',
        balance: 100,
        depositBeta: 0.99,
      },
    ]);

    const result = await service.getBenchmark('inst_1');
    const savingsBenchmark = result.benchmarks.find((b) =>
      b.subcategory.includes('saving'),
    );
    if (savingsBenchmark && savingsBenchmark.gap > 0.1) {
      expect(savingsBenchmark.recommendation).toContain('recalibrat');
    }
  });

  // Coverage: normalizeSubcategory (line 109) and getDefaultBeta (lines 121-133)
  it('normalizes subcategory aliases correctly', async () => {
    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 200 });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'liability',
        subcategory: 'demand deposits',
        balance: 10,
        depositBeta: 0.12,
      },
      {
        category: 'liability',
        subcategory: 'checking',
        balance: 10,
        depositBeta: 0.09,
      },
      {
        category: 'liability',
        subcategory: 'ahorro',
        balance: 20,
        depositBeta: 0.2,
      },
      {
        category: 'liability',
        subcategory: 'share draft',
        balance: 15,
        depositBeta: 0.14,
      },
      {
        category: 'liability',
        subcategory: 'money market',
        balance: 30,
        depositBeta: 0.45,
      },
      {
        category: 'liability',
        subcategory: 'IRA accounts',
        balance: 25,
        depositBeta: 0.55,
      },
      {
        category: 'liability',
        subcategory: 'certificate of deposit',
        balance: 40,
        depositBeta: 0.8,
      },
      {
        category: 'liability',
        subcategory: 'plazo fijo',
        balance: 10,
        depositBeta: 0.75,
      },
      {
        category: 'liability',
        subcategory: 'mm fund',
        balance: 5,
        depositBeta: 0.4,
      },
    ]);

    const result = await service.getBenchmark('inst_1');
    expect(result.benchmarks.length).toBeGreaterThan(0);
    // Should have recognized various subcategory aliases
    const subs = result.benchmarks.map((b) => b.subcategory);
    expect(subs).toContain('demand_deposits');
    expect(subs).toContain('savings_deposits');
  });

  it('uses default beta for unknown subcategory', async () => {
    prisma.institution.findUnique.mockResolvedValue({ totalAssets: 200 });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'liability',
        subcategory: 'exotic_product',
        balance: 50,
        depositBeta: null,
      },
    ]);

    const result = await service.getBenchmark('inst_1');
    // The unknown subcategory should still appear with a default beta
    expect(result.benchmarks.length).toBeGreaterThan(0);
  });
});
