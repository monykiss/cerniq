import { NCUA5300Service } from './ncua-5300.service';

describe('NCUA5300Service', () => {
  let service: NCUA5300Service;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      institution: { findUnique: jest.fn() },
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new NCUA5300Service(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generates form 5300 with fields and summary from balance sheet', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      id: 'inst_1',
      cossecRegistrationNumber: 'CR-001',
    });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'cash', balance: 50 },
      { category: 'asset', subcategory: 'securities', balance: 100 },
      { category: 'asset', subcategory: 'consumer_loans', balance: 80 },
      { category: 'asset', subcategory: 'auto_loans', balance: 60 },
      { category: 'liability', subcategory: 'savings', balance: 120 },
      { category: 'liability', subcategory: 'time_deposits', balance: 100 },
      { category: 'liability', subcategory: 'borrowings', balance: 30 },
    ]);

    const result = await service.generateForm5300('inst_1');

    expect(result.institutionId).toBe('inst_1');
    expect(result.charterNumber).toBe('CR-001');
    expect(result.quarter).toMatch(/^\d{4}Q[1-4]$/);
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.summary.totalAssets).toBe(290);
    expect(result.summary.totalLiabilities).toBe(250);
    expect(result.summary.netWorth).toBeCloseTo(40, 0);
    expect(result.summary.netWorthRatio).toBeGreaterThan(0);
  });

  it('validation passes for balanced balance sheet', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'cash', balance: 100 },
      { category: 'liability', subcategory: 'savings', balance: 90 },
    ]);

    const result = await service.generateForm5300('inst_1');
    expect(result.validationResult.valid).toBe(true);
    expect(result.validationResult.errors).toHaveLength(0);
  });

  it('respects explicit quarter parameter', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    // D1: empty balance sheet now refuses to compute, so provide a minimal
    // BS so we can still test the quarter-parameter path.
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'cash', balance: 100 },
      { category: 'liability', subcategory: 'savings', balance: 90 },
    ]);

    const result = await service.generateForm5300('inst_1', '2025Q4');
    expect(result.quarter).toBe('2025Q4');
  });

  // D1 (2026-04-07): the previous expectation here was that empty balance
  // sheet would silently produce a "valid" form with all-zero summaries.
  // That made phantom-zero NCUA filings indistinguishable from real ones.
  // New contract: empty balance sheet → data_unavailable + CRITICAL gap.
  it('refuses to generate Form 5300 on empty balance sheet, returns data_unavailable + CRITICAL gap', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.generateForm5300('inst_1');

    expect(result.overallStatus).toBe('data_unavailable');
    expect(result.fields).toEqual([]);
    expect(result.validationResult.valid).toBe(false);

    // Gap manifest carries the canonical statement.
    expect(result.gaps).toBeDefined();
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps![0]).toMatchObject({
      field: 'form5300.balanceSheet',
      reason: 'EMPTY_BALANCE_SHEET',
      severity: 'CRITICAL',
    });
  });

  it('always carries WARNING gaps for the hardcoded allowance and delinquency ratios', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'consumer_loans', balance: 100 },
      { category: 'liability', subcategory: 'savings', balance: 90 },
    ]);

    const result = await service.generateForm5300('inst_1');
    expect(result.gaps).toBeDefined();
    expect(result.gaps!.length).toBeGreaterThanOrEqual(2);
    const allowanceGap = result.gaps!.find(
      (g) => g.field === 'form5300.allowance',
    );
    const delinquencyGap = result.gaps!.find(
      (g) => g.field === 'form5300.delinquentLoans',
    );
    expect(allowanceGap).toBeDefined();
    expect(allowanceGap!.severity).toBe('WARNING');
    expect(delinquencyGap).toBeDefined();
    expect(delinquencyGap!.severity).toBe('WARNING');
  });

  it('fields include both asset and liability schedules', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'cash', balance: 50 },
      { category: 'liability', subcategory: 'savings', balance: 40 },
    ]);

    const result = await service.generateForm5300('inst_1');
    const schedules = new Set(result.fields.map((f) => f.schedule));
    expect(schedules.has('A')).toBe(true); // assets
    expect(schedules.has('C')).toBe(true); // liabilities
    expect(schedules.has('D')).toBe(true); // equity
  });
});
