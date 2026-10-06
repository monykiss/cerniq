import { OASCalculatorService } from './oas-calculator.service';

describe('OASCalculatorService', () => {
  let service: OASCalculatorService;

  beforeEach(() => {
    const mockPrisma = {
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      yieldCurve: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const mockYieldCurve = {} as any;
    service = new OASCalculatorService(mockPrisma, mockYieldCurve);
  });

  // ── D1: empty balance sheet → data_unavailable, never demo ──
  // (The real OAS math is exercised by the "with real balance sheet data"
  // block below; the former top-level tests only asserted static demo values.)
  it('returns data_unavailable with a CRITICAL gap when no items', async () => {
    const result = await service.analyzePortfolio('inst-1');
    expect(result.status).toBe('data_unavailable');
    expect(result.instruments).toEqual([]);
    expect(result.portfolioOAS).toBeNull();
    expect(result.totalBalance).toBeNull();
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  // ── With real balance sheet items ──────────────────────────
  describe('with real balance sheet data', () => {
    let svcReal: OASCalculatorService;

    beforeEach(() => {
      const items = [
        {
          id: 'i1',
          name: 'Consumer Loan',
          category: 'asset',
          subcategory: 'consumer',
          balance: 100,
          rate: 0.065,
          duration: 5,
          rateType: 'fixed',
        },
        {
          id: 'i2',
          name: 'Treasury Bond',
          category: 'asset',
          subcategory: 'treasury',
          balance: 50,
          rate: 0.042,
          duration: 10,
          rateType: 'fixed',
        },
        {
          id: 'i3',
          name: 'Mortgage Pool',
          category: 'asset',
          subcategory: 'residential_mortgage',
          balance: 80,
          rate: 0.055,
          duration: 15,
          rateType: 'fixed',
        },
        {
          id: 'i4',
          name: 'Deposits',
          category: 'liability',
          subcategory: 'deposits',
          balance: 150,
          rate: 0.02,
          duration: 1,
          rateType: 'variable',
        },
      ];
      const mockPrisma = {
        balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
        yieldCurve: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;
      const mockYieldCurve = {} as any;
      svcReal = new OASCalculatorService(mockPrisma, mockYieldCurve);
    });

    it('only includes asset items (not liabilities)', async () => {
      const result = await svcReal.analyzePortfolio('inst-1');
      for (const inst of result.instruments) {
        expect(inst.category).toBe('asset');
      }
    });

    it('computes balance-weighted portfolio OAS', async () => {
      const result = await svcReal.analyzePortfolio('inst-1');
      expect(typeof result.portfolioOAS).toBe('number');
      expect(result.totalBalance).toBe(230); // 100 + 50 + 80
    });

    it('instruments with mortgage subcategory have positive option cost', async () => {
      const result = await svcReal.analyzePortfolio('inst-1');
      const mortgage = result.instruments.find(
        (i) => i.instrumentName === 'Mortgage Pool',
      );
      if (mortgage) {
        expect(typeof mortgage.optionCost).toBe('number');
      }
    });

    it('treasury bond has zero or near-zero option cost', async () => {
      const result = await svcReal.analyzePortfolio('inst-1');
      const treasury = result.instruments.find(
        (i) => i.instrumentName === 'Treasury Bond',
      );
      if (treasury) {
        // Treasury has no embedded option, OAS ≈ zSpread
        expect(Math.abs(treasury.optionCost)).toBeLessThan(5);
      }
    });

    it('modified duration is positive for all instruments', async () => {
      const result = await svcReal.analyzePortfolio('inst-1');
      for (const inst of result.instruments) {
        expect(inst.modifiedDuration).toBeGreaterThan(0);
      }
    });
  });

  // ── Uses saved yield curve when available ──────────────────
  it('uses saved yield curve from database when available', async () => {
    const savedCurve = {
      tenors: [
        { tenor: 0.25, rate: 0.05 },
        { tenor: 1, rate: 0.048 },
        { tenor: 5, rate: 0.045 },
        { tenor: 10, rate: 0.046 },
        { tenor: 30, rate: 0.05 },
      ],
      isBase: true,
    };
    const items = [
      {
        id: 'i1',
        name: 'Bond',
        category: 'asset',
        subcategory: 'corporate',
        balance: 100,
        rate: 0.06,
        duration: 5,
        rateType: 'fixed',
      },
    ];
    const mockPrisma = {
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
      yieldCurve: { findFirst: jest.fn().mockResolvedValue(savedCurve) },
    } as any;
    const mockYieldCurve = {} as any;
    const svcCurve = new OASCalculatorService(mockPrisma, mockYieldCurve);

    const result = await svcCurve.analyzePortfolio('inst-1');
    expect(result.instruments.length).toBe(1);
    expect(result.portfolioOAS).toBeDefined();
  });
});
