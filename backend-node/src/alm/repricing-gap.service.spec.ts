import { RepricingGapService } from './repricing-gap.service';

describe('RepricingGapService', () => {
  let service: RepricingGapService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new RepricingGapService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the $445M demo) ─────

  it('returns a data_unavailable shell with a CRITICAL gap when no balance sheet items exist', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.getRepricingGap('inst_123');

    expect(result.status).toBe('data_unavailable');
    expect(result.buckets).toEqual([]);
    expect(result.totalAssets).toBeNull();
    expect(result.totalLiabilities).toBeNull();
    expect(result.durationGap).toBeNull();
    // policyLimitPct echoes the caller's input even in the empty shell.
    expect(result.policyLimitPct).toBe(15);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('repricingGap.balanceSheet');
  });

  it('returns data_unavailable when only equity (no asset/liability) rows exist', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'equity',
        subcategory: 'retained_earnings',
        name: 'Reserves',
        balance: 50,
        rate: 0,
        duration: 0,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');

    expect(result.status).toBe('data_unavailable');
    expect(result.totalAssets).toBeNull();
  });

  // ── Real items bucketed correctly ──────────────────────────

  it('distributes fixed-rate items into correct buckets based on duration', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'loans',
        name: '5yr Fixed Loan',
        balance: 100,
        rate: 0.06,
        duration: 5,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: '1yr CD',
        balance: 80,
        rate: 0.03,
        duration: 1,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');

    expect(result.status).toBe('ok');
    expect(result.totalAssets).toBeCloseTo(100, 0);
    expect(result.totalLiabilities).toBeCloseTo(80, 0);
    expect(result.buckets).toHaveLength(7);
    // Both sides loaded → no data gaps.
    expect(result.gaps).toBeUndefined();

    // 5yr loan: duration * 365 = 1825 days => "3-5 Years" bucket (1096-1825)
    const bucket3to5 = result.buckets.find((b) => b.label === '3–5 Years');
    expect(bucket3to5).toBeDefined();
    expect(bucket3to5!.assets).toBeCloseTo(100, 0);

    // 1yr CD: duration * 365 = 365 days => "181d-1 Year" bucket (181-365)
    const bucket1y = result.buckets.find((b) => b.label === '181d–1 Year');
    expect(bucket1y).toBeDefined();
    expect(bucket1y!.liabilities).toBeCloseTo(80, 0);
  });

  // ── Variable-rate items reprice quickly ────────────────────

  it('places variable-rate demand deposits in the 0-30 day bucket', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'liability',
        subcategory: 'demand_deposits',
        name: 'Checking Accounts',
        balance: 200,
        rate: 0.005,
        duration: 0.1,
        rateType: 'variable',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');

    const shortBucket = result.buckets.find((b) => b.label === '0–30 Days');
    expect(shortBucket).toBeDefined();
    expect(shortBucket!.liabilities).toBeCloseTo(200, 0);
  });

  // ── Policy breach detection ───────────────────────────────

  it('flags policy breach when gap exceeds limit', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Big Loan',
        balance: 500,
        rate: 0.06,
        duration: 2,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Small Deposit',
        balance: 10,
        rate: 0.02,
        duration: 2,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    // Very tight policy limit of 5%
    const result = await service.getRepricingGap('inst_123', 5);

    // The bucket containing both items should have a massive gap/assets ratio
    const breachedBuckets = result.buckets.filter((b) => b.isPolicyBreach);
    expect(breachedBuckets.length).toBeGreaterThan(0);
  });

  // ── Duration gap computation ──────────────────────────────

  it('computes correct duration gap from weighted averages', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Loan A',
        balance: 100,
        rate: 0.05,
        duration: 4,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Deposit A',
        balance: 80,
        rate: 0.02,
        duration: 1,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');

    // Duration gap = asset weighted dur (4) - liability weighted dur (1) = 3
    expect(result.durationGap).toBeCloseTo(3.0, 1);
  });

  it('handles variable-rate items with repriceDate', async () => {
    const futureDate = new Date(Date.now() + 60 * 86400000).toISOString(); // 60 days
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Variable Loan',
        balance: 100,
        rate: 0.05,
        duration: 3,
        rateType: 'variable',
        maturityDate: null,
        repriceDate: futureDate,
      },
      {
        category: 'liability',
        subcategory: 'checking_accounts',
        name: 'Checking',
        balance: 80,
        rate: 0.01,
        duration: 0.1,
        rateType: 'variable',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');
    // Variable asset with repriceDate ~60 days goes into 31-90 bucket
    const bucket31_90 = result.buckets.find((b) => b.label === '31–90 Days');
    expect(bucket31_90).toBeDefined();
    expect(bucket31_90!.assets).toBeCloseTo(100, 0);
    // Checking deposit (demand) reprices in 1 day → 0-30 bucket
    const bucket0_30 = result.buckets.find((b) => b.label === '0–30 Days');
    expect(bucket0_30!.liabilities).toBeCloseTo(80, 0);
  });

  it('handles fixed-rate items with maturityDate', async () => {
    const futureDate = new Date(Date.now() + 180 * 86400000).toISOString();
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'bonds',
        name: 'Bond',
        balance: 100,
        rate: 0.04,
        duration: 0.5,
        rateType: 'fixed',
        maturityDate: futureDate,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');
    // ~180 days maturity → 91-180 bucket
    const bucket = result.buckets.find((b) => b.label === '91–180 Days');
    expect(bucket).toBeDefined();
    expect(bucket!.assets).toBeCloseTo(100, 0);
  });

  it('uses default 90 days for variable-rate non-demand items', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'other_variable',
        name: 'Var Loan',
        balance: 50,
        rate: 0.04,
        duration: 2,
        rateType: 'variable',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');
    const bucket = result.buckets.find((b) => b.label === '31–90 Days');
    expect(bucket!.assets).toBeCloseTo(50, 0);
  });

  // ── D1: one-sided balance sheet is disclosed, not silently zeroed ──

  it('discloses a WARNING gap when only one side of the balance sheet is loaded', async () => {
    // Assets present, no liabilities — the gap is real but incomplete; the
    // missing liability side must surface as a WARNING, not a silent zero.
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Loan',
        balance: 100,
        rate: 0.06,
        duration: 2,
        rateType: 'fixed',
        maturityDate: null,
        repriceDate: null,
      },
    ]);

    const result = await service.getRepricingGap('inst_123');

    expect(result.status).toBe('ok'); // the loaded side is real
    expect(result.totalLiabilities).toBe(0);
    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.reason).toBe('COSSEC_INPUTS_INSUFFICIENT');
    expect(warning!.field).toBe('repricingGap.liabilities');
  });
});
