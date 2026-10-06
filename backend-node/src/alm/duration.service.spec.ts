import { DurationService, BalanceSheetItem } from './duration.service';

describe('DurationService', () => {
  let service: DurationService;

  beforeEach(() => {
    service = new DurationService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── calculateModifiedDuration ──────────────────────────────

  it('calculates modified duration for a 3-year bond', () => {
    // 3-year bond: $100 annual coupon, $1000 par, 5% yield
    const cashFlows = [100, 100, 1100];
    const yieldRate = 0.05;
    const price = 1000;

    const modDuration = service.calculateModifiedDuration(
      cashFlows,
      yieldRate,
      price,
    );

    // Macaulay ~ 2.86, modified ~ 2.72
    expect(modDuration).toBeGreaterThan(2.5);
    expect(modDuration).toBeLessThan(3.0);
  });

  it('returns 0 for empty cash flows or zero price', () => {
    expect(service.calculateModifiedDuration([], 0.05, 1000)).toBe(0);
    expect(service.calculateModifiedDuration([100], 0.05, 0)).toBe(0);
    expect(service.calculateModifiedDuration([100], 0.05, -1)).toBe(0);
  });

  // ── calculateConvexity ────────────────────────────────────

  it('calculates positive convexity for a plain bond', () => {
    const cashFlows = [50, 50, 1050];
    const yieldRate = 0.05;
    const price = 1000;

    const convexity = service.calculateConvexity(cashFlows, yieldRate, price);

    expect(convexity).toBeGreaterThan(0);
    // Convexity for a 3-year bond is typically in the 8-14 range
    expect(convexity).toBeLessThan(20);
  });

  // ── generateCashFlows ─────────────────────────────────────

  it('generates correct annual cash flows for a fixed-rate loan', () => {
    const item: BalanceSheetItem = {
      category: 'asset',
      subcategory: 'loans',
      name: 'Auto Loans',
      balance: 100, // $100M
      rate: 0.06, // 6%
      duration: 5,
      rateType: 'fixed',
      maturityDate: null,
      repriceDate: null,
    };

    const cf = service.generateCashFlows(item);

    expect(cf.maturityYears).toBe(5);
    expect(cf.yieldRate).toBe(0.06);
    expect(cf.cashFlows).toHaveLength(5);
    // First 4 years: coupon only = 100 * 0.06 = 6
    expect(cf.cashFlows[0]).toBeCloseTo(6, 2);
    // Last year: coupon + principal = 6 + 100 = 106
    expect(cf.cashFlows[4]).toBeCloseTo(106, 2);
    expect(cf.price).toBeGreaterThan(0);
  });

  it('auto-detects percentage rates > 1 and converts to decimal', () => {
    const item: BalanceSheetItem = {
      category: 'asset',
      subcategory: 'loans',
      name: 'Mortgage',
      balance: 200,
      rate: 5.5, // should be interpreted as 5.5%
      duration: 10,
      rateType: 'fixed',
    };

    const cf = service.generateCashFlows(item);

    expect(cf.yieldRate).toBeCloseTo(0.055, 4);
  });

  // ── calculatePortfolioMetrics ──────────────────────────────

  it('computes portfolio duration gap from assets and liabilities', () => {
    const items: BalanceSheetItem[] = [
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Fixed Loans',
        balance: 300,
        rate: 0.06,
        duration: 5,
        rateType: 'fixed',
      },
      {
        category: 'asset',
        subcategory: 'securities',
        name: 'Bonds',
        balance: 100,
        rate: 0.04,
        duration: 3,
        rateType: 'fixed',
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Term Deposits',
        balance: 350,
        rate: 0.02,
        duration: 1,
        rateType: 'fixed',
      },
    ];

    const metrics = service.calculatePortfolioMetrics(items);

    expect(metrics.totalAssets).toBe(400);
    expect(metrics.totalLiabilities).toBe(350);
    expect(metrics.assetDuration).toBeGreaterThan(0);
    expect(metrics.liabilityDuration).toBeGreaterThan(0);
    // Assets have longer duration (5yr,3yr) than liabilities (1yr), so gap > 0
    expect(metrics.durationGap).toBeGreaterThan(0);
    expect(metrics.assetDetails).toHaveLength(2);
    expect(metrics.liabilityDetails).toHaveLength(1);
    // Leverage-adjusted gap should also be positive
    expect(metrics.leverageAdjustedDurationGap).toBeGreaterThan(0);
  });

  // ── calculateEVESensitivity ────────────────────────────────

  it('shows negative EVE change for rate increase when asset duration > liability duration', () => {
    // Positive duration gap: rate increase hurts EVE
    const points = service.calculateEVESensitivity(
      4.0, // asset duration
      10, // asset convexity
      400, // total assets
      1.0, // liability duration
      2, // liability convexity
      350, // total liabilities
      [100, 200],
    );

    expect(points).toHaveLength(2);
    // +100bps: assets lose more than liabilities => EVE drops
    const up100 = points[0];
    expect(up100.shockBps).toBe(100);
    expect(up100.eveChange).toBeLessThan(0);
    // +200bps: even larger EVE decline
    expect(points[1].eveChange).toBeLessThan(up100.eveChange);
  });

  // ── fullDurationAnalysis ───────────────────────────────────

  it('runs full analysis pipeline and returns portfolio + EVE results', () => {
    const items: BalanceSheetItem[] = [
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Mortgage Portfolio',
        balance: 500,
        rate: 0.055,
        duration: 7,
        rateType: 'fixed',
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Savings',
        balance: 400,
        rate: 0.015,
        duration: 1,
        rateType: 'variable',
      },
    ];

    const result = service.fullDurationAnalysis(items);

    expect(result.portfolio).toBeDefined();
    expect(result.eveSensitivity).toBeDefined();
    // Default shocks: [-200, -100, 100, 200, 300]
    expect(result.eveSensitivity).toHaveLength(5);
    expect(result.portfolio.totalAssets).toBe(500);
    expect(result.portfolio.totalLiabilities).toBe(400);
  });

  // ── Coverage: Macaulay duration (lines 114-121) ──────────────

  describe('calculateMacaulayDuration', () => {
    it('returns 0 for zero/negative price', () => {
      expect(service.calculateMacaulayDuration([100, 1100], 0.05, 0)).toBe(0);
      expect(service.calculateMacaulayDuration([100, 1100], 0.05, -10)).toBe(0);
    });

    it('returns 0 for empty cash flows', () => {
      expect(service.calculateMacaulayDuration([], 0.05, 1000)).toBe(0);
    });

    it('clamps negative yield to 0', () => {
      const result = service.calculateMacaulayDuration(
        [100, 1100],
        -0.02,
        1000,
      );
      expect(result).toBeGreaterThan(0);
    });

    it('computes Macaulay duration for a 2-year bond', () => {
      const result = service.calculateMacaulayDuration([50, 1050], 0.05, 1000);
      expect(result).toBeGreaterThan(1);
      expect(result).toBeLessThan(2);
    });
  });

  // ── Coverage: maturityDate branch (line 170) and price edge case (line 204) ──

  it('uses maturityDate when provided to determine maturity years', () => {
    const futureDate = new Date(Date.now() + 3 * 365.25 * 24 * 3600 * 1000);
    const item: BalanceSheetItem = {
      category: 'asset',
      subcategory: 'loans',
      name: 'Dated Loan',
      balance: 100,
      rate: 0.05,
      duration: 5, // should be overridden by maturityDate
      rateType: 'fixed',
      maturityDate: futureDate,
    };

    const cf = service.generateCashFlows(item);
    // Maturity determined by maturityDate, not duration
    expect(cf.maturityYears).toBeGreaterThanOrEqual(2);
  });

  it('handles zero-rate edge case where price fallback to balance', () => {
    const item: BalanceSheetItem = {
      category: 'asset',
      subcategory: 'loans',
      name: 'Zero Rate Loan',
      balance: 100,
      rate: 0,
      duration: 3,
      rateType: 'fixed',
    };

    const cf = service.generateCashFlows(item);
    expect(cf.price).toBeGreaterThan(0);
  });
});
