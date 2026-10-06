import { PeerAnalyticsService } from './peer-analytics.service';

describe('PeerAnalyticsService', () => {
  let service: PeerAnalyticsService;
  const mockPrisma = {
    institution: {
      findUnique: jest.fn().mockResolvedValue({ totalAssets: 200 }),
    },
    balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;

  beforeEach(() => {
    service = new PeerAnalyticsService(mockPrisma);
  });

  it('should return medium tier for $200M institution', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    expect(result.assetTier).toBe('medium');
    expect(result.peerGroupName).toContain('$50M');
  });

  it('should return 6 peer metrics', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    expect(result.metrics).toHaveLength(6);
  });

  it('each metric percentileRank is 0-100 OR null when data unavailable', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    for (const m of result.metrics) {
      if (m.percentileRank === null) {
        expect(m.status).toBe('data_unavailable');
        expect(m.institutionValue).toBeNull();
        continue;
      }
      expect(m.percentileRank).toBeGreaterThanOrEqual(0);
      expect(m.percentileRank).toBeLessThanOrEqual(100);
    }
  });

  // D1 (2026-04-07): the previous expectation was that NIM defaulted to a
  // hardcoded 3.5 when no balance sheet items existed. That literal 3.5
  // was then ranked against peer benchmarks and presented as institutional
  // performance — a phantom comparison. New contract: empty BS → NIM is
  // null + status 'data_unavailable'.
  it('NIM is null with status data_unavailable when balance sheet is empty', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    const nim = result.metrics.find((m) =>
      m.metricName.includes('Net Interest Margin'),
    );
    expect(nim!.institutionValue).toBeNull();
    expect(nim!.status).toBe('data_unavailable');
    expect(nim!.percentileRank).toBeNull();
  });

  it('small tier for < $50M assets', async () => {
    const smallPrisma = {
      institution: {
        findUnique: jest.fn().mockResolvedValue({ totalAssets: 30 }),
      },
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new PeerAnalyticsService(smallPrisma);
    const result = await svc.getPeerAnalytics('inst-1');
    expect(result.assetTier).toBe('small');
  });

  // ── large tier ──────────────────────────────────────────────
  it('large tier for > $300M assets', async () => {
    const largePrisma = {
      institution: {
        findUnique: jest.fn().mockResolvedValue({ totalAssets: 500 }),
      },
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new PeerAnalyticsService(largePrisma);
    const result = await svc.getPeerAnalytics('inst-1');
    expect(result.assetTier).toBe('large');
    expect(result.peerGroupName).toContain('>');
  });

  // D1 (2026-04-07): the previous behavior fell back to $200M (medium tier)
  // when institution.totalAssets was missing. That phantom tier
  // determined which peer benchmarks the institution was compared
  // against — a phantom comparison. New contract: missing institution OR
  // missing totalAssets → data_unavailable + CRITICAL gap.
  it('returns data_unavailable + CRITICAL gap when institution is null', async () => {
    const nullPrisma = {
      institution: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new PeerAnalyticsService(nullPrisma);
    const result = await svc.getPeerAnalytics('inst-1');
    expect(result.overallStatus).toBe('data_unavailable');
    expect(result.assetTier).toBe('unknown');
    expect(result.metrics).toEqual([]);
    expect(result.gaps).toBeDefined();
    expect(result.gaps![0].field).toBe('peer.institution');
    expect(result.gaps![0].severity).toBe('CRITICAL');
  });

  // ── percentile rank boundaries ──────────────────────────────
  describe('percentile rank computation', () => {
    it('assigns top_quartile status for high NIM (computed from real BS items)', async () => {
      // D1 (2026-04-07): need real balance sheet items for NIM to be
      // non-null. Provide a high-NIM institution and verify the rank
      // lands in the top quartile.
      const highNimPrisma = {
        institution: {
          findUnique: jest.fn().mockResolvedValue({ totalAssets: 200 }),
        },
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            // Assets: $200M at 7% yield = $14M income
            {
              category: 'asset',
              subcategory: 'loans',
              balance: 200,
              rate: 0.07,
            },
            // Liabs: $150M at 1% cost = $1.5M expense
            // NIM = (14 - 1.5) / 200 * 100 = 6.25% — top quartile for medium tier (p75=4.2)
            {
              category: 'liability',
              subcategory: 'deposits',
              balance: 150,
              rate: 0.01,
            },
          ]),
        },
      } as any;
      const svc = new PeerAnalyticsService(highNimPrisma);
      const result = await svc.getPeerAnalytics('inst-1');
      const nim = result.metrics.find((m) =>
        m.metricName.includes('Net Interest Margin'),
      );
      expect(nim!.percentileRank).not.toBeNull();
      expect(nim!.percentileRank!).toBeGreaterThanOrEqual(75);
      expect(nim!.status).toBe('top_quartile');
    });

    it('assigns bottom_quartile status for very low values', async () => {
      const result = await service.getPeerAnalytics('inst-1');
      // Check that status mapping is consistent. D1 (2026-04-07): metrics
      // with null percentileRank get status 'data_unavailable' instead of
      // a quartile bucket.
      for (const m of result.metrics) {
        if (m.percentileRank === null) {
          expect(m.status).toBe('data_unavailable');
          continue;
        }
        if (m.percentileRank >= 75) expect(m.status).toBe('top_quartile');
        else if (m.percentileRank >= 50) expect(m.status).toBe('above_median');
        else if (m.percentileRank >= 25) expect(m.status).toBe('below_median');
        else expect(m.status).toBe('bottom_quartile');
      }
    });

    it('returns 0 percentile for value below min (or null when unavailable)', async () => {
      // This tests the clamp at 0 in computePercentileRank.
      const result = await service.getPeerAnalytics('inst-1');
      for (const m of result.metrics) {
        if (m.percentileRank === null) continue;
        expect(m.percentileRank).toBeGreaterThanOrEqual(0);
        expect(m.percentileRank).toBeLessThanOrEqual(100);
      }
    });
  });

  // ── "lower is better" metrics ───────────────────────────────
  // D1 (2026-04-07): EVE_Sensitivity, Deposit_Beta, LCR, and CECL_Coverage
  // are NOT YET wired to real sources — they return null + a WARNING gap
  // naming the source they should come from. The previous behavior
  // hardcoded these to literal numbers (15.2, 0.18, 115, 1.3) and ranked
  // institutions against peers using the literals. The tests below now
  // assert that those metrics are explicitly null until wired in.
  describe('lower-is-better metrics (currently unwired)', () => {
    it('EVE_Sensitivity is null + WARNING gap until DurationService is wired', async () => {
      const result = await service.getPeerAnalytics('inst-1');
      const eve = result.metrics.find((m) =>
        m.metricName.includes('EVE Sensitivity'),
      );
      expect(eve).toBeDefined();
      expect(eve!.institutionValue).toBeNull();
      expect(eve!.percentileRank).toBeNull();
      expect(eve!.status).toBe('data_unavailable');
      expect(
        result.gaps?.some((g) => g.field === 'peer.metrics.EVE_Sensitivity'),
      ).toBe(true);
    });

    it('Deposit_Beta is null + WARNING gap until DepositBetaService is wired', async () => {
      const result = await service.getPeerAnalytics('inst-1');
      const beta = result.metrics.find((m) =>
        m.metricName.includes('Deposit Beta'),
      );
      expect(beta).toBeDefined();
      expect(beta!.institutionValue).toBeNull();
      expect(beta!.percentileRank).toBeNull();
      expect(beta!.status).toBe('data_unavailable');
    });
  });

  // ── Spanish labels ──────────────────────────────────────────
  describe('bilingual labels', () => {
    it('each metric has Spanish label', async () => {
      const result = await service.getPeerAnalytics('inst-1');
      for (const m of result.metrics) {
        expect(m.metricNameEs).toBeDefined();
        expect(m.metricNameEs.length).toBeGreaterThan(0);
      }
    });

    it('peer group has Spanish name', async () => {
      const result = await service.getPeerAnalytics('inst-1');
      expect(result.peerGroupNameEs).toBeDefined();
      expect(result.peerGroupNameEs).toContain('Cooperativas PR');
    });
  });

  // ── real balance sheet metrics ──────────────────────────────
  describe('with balance sheet items', () => {
    it('computes NIM from actual asset income and liability cost', async () => {
      const realPrisma = {
        institution: {
          findUnique: jest.fn().mockResolvedValue({ totalAssets: 200 }),
        },
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              category: 'asset',
              subcategory: 'loans',
              balance: 150,
              rate: 0.06,
            },
            {
              category: 'asset',
              subcategory: 'securities',
              balance: 50,
              rate: 0.04,
            },
            {
              category: 'liability',
              subcategory: 'deposits',
              balance: 180,
              rate: 0.02,
            },
          ]),
        },
      } as any;
      const svc = new PeerAnalyticsService(realPrisma);
      const result = await svc.getPeerAnalytics('inst-1');

      const nim = result.metrics.find((m) =>
        m.metricName.includes('Net Interest Margin'),
      );
      // NIM = ((150*0.06 + 50*0.04) - 180*0.02) / 200 * 100
      // = (9 + 2 - 3.6) / 200 * 100 = 7.4 / 200 * 100 = 3.7
      expect(nim!.institutionValue).toBeCloseTo(3.7, 1);
    });

    it('computes Loan-to-Share ratio from balance sheet', async () => {
      const realPrisma = {
        institution: {
          findUnique: jest.fn().mockResolvedValue({ totalAssets: 200 }),
        },
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              category: 'asset',
              subcategory: 'loans',
              balance: 120,
              rate: 0.06,
            },
            { category: 'asset', subcategory: 'cash', balance: 30, rate: 0.01 },
            {
              category: 'asset',
              subcategory: 'securities',
              balance: 50,
              rate: 0.04,
            },
            {
              category: 'liability',
              subcategory: 'deposits',
              balance: 180,
              rate: 0.02,
            },
          ]),
        },
      } as any;
      const svc = new PeerAnalyticsService(realPrisma);
      const result = await svc.getPeerAnalytics('inst-1');

      const lts = result.metrics.find((m) =>
        m.metricName.includes('Loan-to-Share'),
      );
      // totalLoans = 120 (loans, excludes cash and securities)
      // totalLiabs = 180
      // loanToShare = (120 / 180) * 100 = 66.67
      expect(lts!.institutionValue).toBeCloseTo(66.7, 0);
    });
  });

  // ── peer count ─────────────────────────────────────────────
  it('returns correct peer count for each tier', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    // Medium tier has 43 peers
    expect(result.peerCount).toBe(43);
  });

  it('institutionId is preserved in result', async () => {
    const result = await service.getPeerAnalytics('inst-1');
    expect(result.institutionId).toBe('inst-1');
  });
});
