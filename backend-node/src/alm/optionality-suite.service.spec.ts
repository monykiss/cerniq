import { OptionalitySuiteService } from './optionality-suite.service';

describe('OptionalitySuiteService', () => {
  const mk = (items: unknown[]) =>
    new OptionalitySuiteService(
      {
        balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
      } as any,
      {} as any,
    );

  // ── D1: honest empty-data shell (never the 4.2yr-duration demo) ─

  it('returns a data_unavailable shell with null metrics + CRITICAL gap when no items', async () => {
    const result = await mk([]).analyzePortfolio('inst-1');

    expect(result.status).toBe('data_unavailable');
    expect(result.portfolioModDuration).toBeNull();
    expect(result.portfolioEffDuration).toBeNull();
    expect(result.portfolioConvexity).toBeNull();
    expect(result.durationGap).toBeNull();
    expect(result.negConvexityBalance).toBeNull();
    expect(result.negConvexityPct).toBeNull();
    expect(result.keyRiskTenor).toBeNull();
    expect(result.instruments).toEqual([]);
    expect(result.durationMismatchHeatmap).toEqual([]);
    expect(result.convexityContributors).toEqual([]);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('optionalitySuite.balanceSheet');
  });

  // ── D1: real-data computation ──────────────────────────────────

  describe('analyzePortfolio with real items', () => {
    let serviceWithItems: OptionalitySuiteService;

    beforeEach(() => {
      serviceWithItems = mk([
        {
          id: '1',
          name: 'Residential Mortgages',
          category: 'asset',
          subcategory: 'residential_mortgage',
          balance: 100,
          duration: 5,
          rate: 0.05,
          rateType: 'fixed',
        },
        {
          id: '2',
          name: 'MBS Pool',
          category: 'asset',
          subcategory: 'mbs',
          balance: 50,
          duration: 7,
          rate: 0.04,
          rateType: 'fixed',
        },
        {
          id: '3',
          name: 'Commercial Loan',
          category: 'asset',
          subcategory: 'commercial',
          balance: 80,
          duration: 3,
          rate: 0.06,
          rateType: 'fixed',
        },
        {
          id: '4',
          name: 'Variable Rate CD',
          category: 'liability',
          subcategory: 'deposits',
          balance: 120,
          duration: 2,
          rate: 0.02,
          rateType: 'variable',
        },
        {
          id: '5',
          name: 'Fixed Deposits',
          category: 'liability',
          subcategory: 'deposits',
          balance: 60,
          duration: 1,
          rate: 0.015,
          rateType: 'fixed',
        },
      ]);
    });

    it('returns status ok with no gaps and effDur ≤ modDur', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.portfolioEffDuration!).toBeLessThanOrEqual(
        result.portfolioModDuration!,
      );
    });

    it('classifies prepayable and callable instruments correctly', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      const mortgage = result.instruments.find(
        (i) => i.instrumentName === 'Residential Mortgages',
      );
      const mbs = result.instruments.find(
        (i) => i.instrumentName === 'MBS Pool',
      );
      const commercial = result.instruments.find(
        (i) => i.instrumentName === 'Commercial Loan',
      );

      expect(mortgage!.optionType).toBe('prepayable');
      expect(mbs!.optionType).toBe('callable');
      expect(commercial!.optionType).toBe('none');
    });

    it('prepayable/callable instruments have negative convexity', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      const mortgage = result.instruments.find(
        (i) => i.instrumentName === 'Residential Mortgages',
      );
      const mbs = result.instruments.find(
        (i) => i.instrumentName === 'MBS Pool',
      );

      expect(mortgage!.isNegativelyConvex).toBe(true);
      expect(mortgage!.effectiveConvexity).toBeLessThan(0);
      expect(mbs!.isNegativelyConvex).toBe(true);
    });

    it('effective duration is less than modified duration for optioned instruments', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      const mortgage = result.instruments.find(
        (i) => i.instrumentName === 'Residential Mortgages',
      );
      expect(mortgage!.effectiveDuration).toBeLessThan(
        mortgage!.modifiedDuration,
      );
    });

    it('duration mismatch heatmap has entries for all 5 maturity buckets', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      expect(result.durationMismatchHeatmap).toHaveLength(5);
      const buckets = result.durationMismatchHeatmap.map((h) => h.bucket);
      expect(buckets).toEqual(['0-1Y', '1-3Y', '3-5Y', '5-10Y', '10Y+']);
    });

    it('negConvexityPct is the pct of negatively convex assets vs total assets', async () => {
      const result = await serviceWithItems.analyzePortfolio('inst-1');
      // mortgage(100) + mbs(50) are neg convex; total assets = 100+50+80 = 230
      expect(result.negConvexityBalance!).toBeCloseTo(150, 0);
      expect(result.negConvexityPct!).toBeCloseTo((150 / 230) * 100, 0);
    });
  });

  describe('classifyOptionType via variable rateType', () => {
    it('classifies variable-rate instruments as indexed', async () => {
      const svc = mk([
        {
          id: '1',
          name: 'SOFR Loan',
          category: 'asset',
          subcategory: 'commercial',
          balance: 50,
          duration: 3,
          rate: 0.04,
          rateType: 'variable',
        },
      ]);
      const result = await svc.analyzePortfolio('inst-1');
      expect(result.instruments[0].optionType).toBe('indexed');
    });
  });
});
