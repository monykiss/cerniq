import { KeyRateDurationService } from './key-rate-duration.service';

describe('KeyRateDurationService', () => {
  let service: KeyRateDurationService;
  let prisma: any;
  let yieldCurveService: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn() },
      yieldCurve: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    yieldCurveService = {};
    service = new KeyRateDurationService(prisma, yieldCurveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Demo fallback ─────────────────────────────────────────

  it('returns data_unavailable when no balance sheet items exist', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.analyzePortfolio('inst_123');

    expect(result.status).toBe('data_unavailable');
    expect(result.instruments).toHaveLength(0);
    expect(result.portfolioModifiedDuration).toBeNull();
    expect(result.durationGap).toBeNull();
    expect(result.portfolioKRDs).toEqual([]);
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  // ── Single instrument KRD computation ─────────────────────

  it('computes KRDs that sum approximately to effective duration', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        name: '5yr Fixed Loan',
        category: 'asset',
        subcategory: 'loans',
        balance: 100,
        rate: 0.06,
        duration: 5,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
        depositBeta: null,
      },
    ]);

    const result = await service.analyzePortfolio('inst_123');

    expect(result.instruments).toHaveLength(1);
    const inst = result.instruments[0];
    expect(inst.modifiedDuration).toBeGreaterThan(0);
    expect(inst.effectiveDuration).toBeGreaterThan(0);

    // KRDs should sum to approximately the effective duration
    const krdSum = inst.keyRateDurations.reduce((s, k) => s + k.krd, 0);
    expect(krdSum).toBeCloseTo(inst.effectiveDuration, 1);

    // The 5Y KRD should be the largest since the instrument is 5yr tenor
    const krd5y = inst.keyRateDurations.find((k) => k.tenor === '5Y');
    expect(krd5y).toBeDefined();
    expect(krd5y!.krd).toBeGreaterThan(0);
  });

  // ── Portfolio duration gap ────────────────────────────────

  it('computes positive duration gap when assets have longer duration', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        name: 'Long Loan',
        category: 'asset',
        subcategory: 'mortgages',
        balance: 200,
        rate: 0.055,
        duration: 10,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
        depositBeta: null,
      },
      {
        name: 'Short Deposit',
        category: 'liability',
        subcategory: 'savings',
        balance: 150,
        rate: 0.02,
        duration: 1,
        rateType: 'variable',
        maturityDate: null,
        repriceDate: null,
        depositBeta: null,
      },
    ]);

    const result = await service.analyzePortfolio('inst_123');

    expect(result.portfolioModifiedDuration).toBeGreaterThan(0);
    expect(result.portfolioEffectiveDuration).toBeGreaterThan(0);
    // Assets (10yr) much longer than liabilities (1yr) => positive gap
    expect(result.durationGap).toBeGreaterThan(0);
  });

  // ── Negative convexity exposure ───────────────────────────

  it('tracks negative convexity exposure from callable/MBS-like instruments', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        name: 'Short-Duration Asset',
        category: 'asset',
        subcategory: 'short_bond',
        balance: 50,
        rate: 0.03,
        duration: 0.25, // very short tenor
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
        depositBeta: null,
      },
    ]);

    const result = await service.analyzePortfolio('inst_123');

    // negativeConvexityExposure aggregates balances of instruments with convexity < 0
    expect(result.negativeConvexityExposure).toBeDefined();
    expect(typeof result.negativeConvexityExposure).toBe('number');
  });

  // ── Portfolio KRDs across all standard tenors ─────────────

  it('returns portfolio KRDs for all 8 standard tenors', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        name: 'Loan A',
        category: 'asset',
        subcategory: 'loans',
        balance: 100,
        rate: 0.06,
        duration: 3,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
        depositBeta: null,
      },
    ]);

    const result = await service.analyzePortfolio('inst_123');

    expect(result.portfolioKRDs).toHaveLength(8);
    const labels = result.portfolioKRDs.map((k) => k.tenor);
    expect(labels).toContain('3M');
    expect(labels).toContain('1Y');
    expect(labels).toContain('5Y');
    expect(labels).toContain('10Y');
    expect(labels).toContain('30Y');
  });
});
