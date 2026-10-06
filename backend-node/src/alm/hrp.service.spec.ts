import { HRPService } from './hrp.service';

describe('HRPService', () => {
  let service: HRPService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new HRPService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns data_unavailable when fewer than 2 asset subcategories', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cash', category: 'asset', balance: 100, rate: 0.01 },
    ]);
    const result = await service.computeHRP('inst_1');

    expect(result.status).toBe('data_unavailable');
    expect(result.weights).toEqual([]);
    expect(result.diversificationRatio).toBeNull();
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  it('computes weights that sum to 1.0', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cash', category: 'asset', balance: 50, rate: 0.01 },
      {
        subcategory: 'securities',
        category: 'asset',
        balance: 200,
        rate: 0.04,
      },
      { subcategory: 'mortgage', category: 'asset', balance: 300, rate: 0.055 },
      {
        subcategory: 'commercial',
        category: 'asset',
        balance: 150,
        rate: 0.06,
      },
    ]);

    const result = await service.computeHRP('inst_1');
    const weightSum = result.weights.reduce((s, w) => s + w, 0);
    expect(weightSum).toBeCloseTo(1.0, 2);
  });

  it('assigns lower weight to higher-volatility assets', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cash', category: 'asset', balance: 100, rate: 0.01 },
      {
        subcategory: 'commercial_loans',
        category: 'asset',
        balance: 100,
        rate: 0.07,
      },
    ]);

    const result = await service.computeHRP('inst_1');
    const cashIdx = result.assetNames.indexOf('cash');
    const commIdx = result.assetNames.indexOf('commercial_loans');
    // Cash vol = 0.01, commercial vol = 0.08 -> cash should get higher weight
    expect(result.weights[cashIdx]).toBeGreaterThan(result.weights[commIdx]);
  });

  it('diversification ratio is greater than 1 for diversified portfolio', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cash', category: 'asset', balance: 50, rate: 0.01 },
      {
        subcategory: 'securities',
        category: 'asset',
        balance: 150,
        rate: 0.04,
      },
      {
        subcategory: 'consumer_loans',
        category: 'asset',
        balance: 200,
        rate: 0.06,
      },
    ]);

    const result = await service.computeHRP('inst_1');
    expect(result.diversificationRatio).toBeGreaterThan(1.0);
  });

  it('portfolio vol is positive and less than max individual vol', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cash', category: 'asset', balance: 100, rate: 0.01 },
      { subcategory: 'mortgage', category: 'asset', balance: 200, rate: 0.055 },
    ]);

    const result = await service.computeHRP('inst_1');
    expect(result.portfolioVol).toBeGreaterThan(0);
    expect(result.portfolioVol).toBeLessThan(0.08); // max single asset vol
  });

  it('uses default vol of 0.05 for unknown asset subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'exotic_derivatives',
        category: 'asset',
        balance: 100,
        rate: 0.05,
      },
      { subcategory: 'cash', category: 'asset', balance: 100, rate: 0.01 },
    ]);
    const result = await service.computeHRP('inst_1');
    expect(result.portfolioVol).toBeGreaterThan(0);
  });
});
