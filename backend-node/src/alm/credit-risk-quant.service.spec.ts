import { CreditRiskQuantService } from './credit-risk-quant.service';

// Representative loan segments (formerly the service's hardcoded demo set —
// now supplied as real input so the PD/EL/EC math is still exercised, while
// the service itself no longer fabricates data on empty input).
const SEGMENTS = [
  {
    segmentName: 'Consumer Loans',
    balance: 85,
    weightedAvgMaturity: 3.5,
    historicalLossRate: 0.018,
    lgd: 0.45,
  },
  {
    segmentName: 'Auto Loans',
    balance: 62,
    weightedAvgMaturity: 4.2,
    historicalLossRate: 0.012,
    lgd: 0.35,
  },
  {
    segmentName: 'Commercial RE',
    balance: 120,
    weightedAvgMaturity: 7.5,
    historicalLossRate: 0.008,
    lgd: 0.4,
  },
  {
    segmentName: 'Residential Mortgage',
    balance: 95,
    weightedAvgMaturity: 15.0,
    historicalLossRate: 0.004,
    lgd: 0.3,
  },
  {
    segmentName: 'Credit Cards',
    balance: 28,
    weightedAvgMaturity: 1.5,
    historicalLossRate: 0.035,
    lgd: 0.8,
  },
  {
    segmentName: 'Commercial & Industrial',
    balance: 55,
    weightedAvgMaturity: 5.0,
    historicalLossRate: 0.015,
    lgd: 0.5,
  },
];

describe('CreditRiskQuantService', () => {
  let svc: CreditRiskQuantService;

  beforeEach(() => {
    const mockPrisma = {
      loanSegment: { findMany: jest.fn().mockResolvedValue(SEGMENTS) },
      institution: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    svc = new CreditRiskQuantService(mockPrisma);
  });

  // ── D1: empty portfolio → data_unavailable, never demo ──────────
  it('returns a data_unavailable shell with a CRITICAL gap when there are no loan segments', async () => {
    const empty = new CreditRiskQuantService({
      loanSegment: { findMany: jest.fn().mockResolvedValue([]) },
      institution: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any);

    const result = await empty.analyzePortfolio('inst-empty');
    expect(result.status).toBe('data_unavailable');
    expect(result.segments).toEqual([]);
    expect(result.totalEAD).toBeNull();
    expect(result.totalEC).toBeNull();
    expect(result.capitalAdequacy).toBeNull();
    expect(
      result.gaps?.some(
        (g) => g.reason === 'NO_LOAN_SEGMENTS' && g.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  it('returns an ok portfolio with the correct shape for real segments', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    expect(result.status).toBe('ok');
    expect(result).toHaveProperty('totalEAD');
    expect(result).toHaveProperty('totalEL');
    expect(result).toHaveProperty('totalUL');
    expect(result).toHaveProperty('totalEC');
    expect(result).toHaveProperty('portfolioElPct');
    expect(result).toHaveProperty('portfolioEcPct');
    expect(result).toHaveProperty('capitalAdequacy');
    expect(result.segments.length).toBe(6);
  });

  it('should have economic capital >= unexpected loss per segment', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    for (const seg of result.segments) {
      expect(seg.economicCapital).toBeGreaterThanOrEqual(seg.unexpectedLoss);
    }
  });

  it('should compute totalEAD as sum of segment balances', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    const sumBalances = result.segments.reduce((s, seg) => s + seg.balance, 0);
    expect(result.totalEAD).toBeCloseTo(sumBalances, 0);
  });

  it('should have annual PD between 0 and 1 for all segments', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    for (const seg of result.segments) {
      expect(seg.annualPD).toBeGreaterThan(0);
      expect(seg.annualPD).toBeLessThanOrEqual(1);
    }
  });

  it('should have lifetime PD >= annual PD for all segments', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    for (const seg of result.segments) {
      expect(seg.lifetimePD).toBeGreaterThanOrEqual(seg.annualPD);
    }
  });

  it('should assess capital adequacy', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    expect(result.capitalAdequacy).toHaveProperty('actualCapital');
    expect(result.capitalAdequacy).toHaveProperty('requiredEconomicCapital');
    expect(result.capitalAdequacy).toHaveProperty('capitalSurplus');
    expect(result.capitalAdequacy).toHaveProperty('isAdequate');
  });

  // ── Coverage: with a different real portfolio ──────────────────
  it('uses the supplied loan segments', async () => {
    const mockPrismaReal = {
      loanSegment: {
        findMany: jest.fn().mockResolvedValue([
          {
            segmentName: 'residential_mortgage',
            balance: 5000,
            historicalLossRate: 0.01,
            weightedAvgMaturity: 15,
          },
          {
            segmentName: 'auto_loans',
            balance: 3000,
            historicalLossRate: 0.02,
            weightedAvgMaturity: 4,
          },
        ]),
      },
      institution: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'inst-real', totalAssets: 10000 }),
      },
    } as any;
    const realSvc = new CreditRiskQuantService(mockPrismaReal);
    const result = await realSvc.analyzePortfolio('inst-real');
    expect(result.status).toBe('ok');
    expect(result.totalEAD).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('computes different PD/LGD for each segment type', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    const names = result.segments.map((s) => s.segmentName);
    expect(names).toContain('Consumer Loans');
    expect(names).toContain('Auto Loans');
    expect(names).toContain('Credit Cards');
    const lgds = result.segments.map((s) => s.lgd);
    expect(new Set(lgds).size).toBeGreaterThan(1);
  });

  it('computes portfolio-level EL and EC percentages', async () => {
    const result = await svc.analyzePortfolio('inst-1');
    expect(result.portfolioElPct!).toBeGreaterThan(0);
    expect(result.portfolioElPct!).toBeLessThan(100);
    expect(result.portfolioEcPct!).toBeGreaterThan(0);
  });
});
