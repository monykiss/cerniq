import { FRTBESService } from './frtb-es.service';

describe('FRTBESService', () => {
  const mk = (items: unknown[]) =>
    new FRTBESService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
    } as any);

  it('should be defined', () => {
    expect(mk([])).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the $8.4M demo) ─────────

  it('returns a data_unavailable shell with null metrics + CRITICAL gap when no balance sheet', async () => {
    const result = await mk([]).computeFRTBCapital('inst_1');

    expect(result.status).toBe('data_unavailable');
    expect(result.expectedShortfall975).toBeNull();
    expect(result.liquidityAdjustedES).toBeNull();
    expect(result.stressedES).toBeNull();
    expect(result.imcc).toBeNull();
    expect(result.capitalCharge).toBeNull();
    expect(result.multiplier).toBeNull();
    expect(result.backtestExceptions).toBeNull();
    expect(result.backtestTrafficLight).toBeNull();
    expect(result.byRiskClass).toEqual([]);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('frtbES.balanceSheet');
  });

  // ── D1: real-data computation ──────────────────────────────────

  describe('with real balance sheet items', () => {
    it('computes ES and capital charge with status ok', async () => {
      const result = await mk([
        { category: 'asset', subcategory: 'treasury_securities', balance: 500 },
        { category: 'asset', subcategory: 'mortgage_loans', balance: 300 },
        { category: 'liability', subcategory: 'deposits', balance: 700 },
      ]).computeFRTBCapital('inst_1');

      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.expectedShortfall975!).toBeGreaterThan(0);
      expect(result.liquidityAdjustedES!).toBeGreaterThan(0);
      expect(result.stressedES!).toBeCloseTo(
        result.expectedShortfall975! * 2.5,
        1,
      );
      expect(result.capitalCharge!).toBeGreaterThan(0);
    });

    it('classifies risk factors by subcategory', async () => {
      const result = await mk([
        { category: 'asset', subcategory: 'treasury_securities', balance: 100 },
        { category: 'asset', subcategory: 'commercial_loans', balance: 200 },
      ]).computeFRTBCapital('inst_1');

      const riskClasses = result.byRiskClass.map((rc) => rc.riskClass);
      expect(riskClasses).toContain('interest_rate_large');
      expect(riskClasses).toContain('credit_spread_hy');
    });

    it('assigns a valid backtest traffic light', async () => {
      const result = await mk([
        { category: 'asset', subcategory: 'securities', balance: 1000 },
      ]).computeFRTBCapital('inst_1');

      expect(['GREEN', 'AMBER', 'RED']).toContain(result.backtestTrafficLight!);
      expect(result.backtestExceptions!).toBeGreaterThanOrEqual(0);
    });

    it('maps liquidity horizons per risk class', async () => {
      const result = await mk([
        { category: 'asset', subcategory: 'treasury_securities', balance: 100 },
        { category: 'asset', subcategory: 'mbs_pool', balance: 100 },
      ]).computeFRTBCapital('inst_1');

      const treasury = result.byRiskClass.find(
        (rc) => rc.riskClass === 'interest_rate_large',
      );
      if (treasury) expect(treasury.liquidityHorizon).toBe(10);
    });
  });
});
