import { FTPAttributionService } from './ftp-attribution.service';

describe('FTPAttributionService', () => {
  let service: FTPAttributionService;

  // Mock FTPService with known instruments
  const mockFTPResult = {
    instruments: [
      {
        name: 'Consumer Auto Loans',
        category: 'asset',
        subcategory: 'auto_loans',
        balance: 50_000_000,
        actualRate: 0.065,
        ftpRate: 0.042,
      },
      {
        name: 'Residential Mortgages',
        category: 'asset',
        subcategory: 'residential_mortgage',
        balance: 200_000_000,
        actualRate: 0.055,
        ftpRate: 0.041,
      },
      {
        name: 'Core Deposits',
        category: 'liability',
        subcategory: 'savings',
        balance: 150_000_000,
        actualRate: 0.015,
        ftpRate: 0.035,
      },
    ],
    summary: {
      netFTPMargin: 5_000_000,
    },
  };

  const mockFtp = {
    getFTPAnalysis: jest.fn().mockResolvedValue(mockFTPResult),
  };

  const mockPrisma = {} as any;

  beforeEach(() => {
    service = new FTPAttributionService(mockPrisma, mockFtp as any);
    jest.clearAllMocks();
    mockFtp.getFTPAnalysis.mockResolvedValue(mockFTPResult);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Spread Decomposition ───────────────────────────────────

  it('should decompose FTP net spread as actualRate minus ftpRate for assets', async () => {
    const result = await service.getFullAttribution('inst-1');

    const autoLoans = result.decompositions.find(
      (d) => d.subcategory === 'auto_loans',
    );
    expect(autoLoans).toBeDefined();
    // FTP net for asset = actualRate - ftpRate = 0.065 - 0.042 = 0.023
    expect(autoLoans!.ftpNet).toBeCloseTo(0.023, 4);
  });

  it('should decompose FTP net spread as ftpRate minus actualRate for liabilities', async () => {
    const result = await service.getFullAttribution('inst-1');

    const deposits = result.decompositions.find(
      (d) => d.subcategory === 'savings',
    );
    expect(deposits).toBeDefined();
    // FTP net for liability = ftpRate - actualRate = 0.035 - 0.015 = 0.020
    expect(deposits!.ftpNet).toBeCloseTo(0.02, 4);
  });

  it('should assign credit spread from lookup table for known asset types', async () => {
    const result = await service.getFullAttribution('inst-1');

    const mortgage = result.decompositions.find(
      (d) => d.subcategory === 'residential_mortgage',
    );
    expect(mortgage).toBeDefined();
    // residential_mortgage credit spread = 0.004
    expect(mortgage!.creditSpread).toBeCloseTo(0.004, 4);

    const auto = result.decompositions.find(
      (d) => d.subcategory === 'auto_loans',
    );
    expect(auto!.creditSpread).toBeCloseTo(0.012, 4);
  });

  it('should assign zero credit spread and option cost to liabilities', async () => {
    const result = await service.getFullAttribution('inst-1');

    const deposits = result.decompositions.find(
      (d) => d.category === 'liability',
    );
    expect(deposits).toBeDefined();
    expect(deposits!.creditSpread).toBe(0);
    expect(deposits!.optionCost).toBe(0);
    expect(deposits!.liquidityPremium).toBe(0);
  });

  it('should compute economic profit as balance x (ftpNet - creditSpread - optionCost - liquidityPremium - opCost)', async () => {
    const result = await service.getFullAttribution('inst-1');

    for (const d of result.decompositions) {
      const expectedProfit =
        d.balance *
        (d.ftpNet -
          d.creditSpread -
          d.optionCost -
          d.liquidityPremium -
          d.opCost);
      expect(d.economicProfit).toBeCloseTo(expectedProfit, 0);
    }
  });

  // ── RAROC Ranking ──────────────────────────────────────────

  it('should compute RAROC as economic profit divided by capital consumed (8% of balance)', async () => {
    const result = await service.getFullAttribution('inst-1');

    for (const r of result.rarocRanking) {
      const expectedCapital = r.totalBalance * 0.08;
      expect(r.capitalConsumed).toBeCloseTo(expectedCapital, 0);
      if (r.capitalConsumed > 0) {
        const expectedRaroc = r.totalEconomicProfit / r.capitalConsumed;
        expect(r.raroc).toBeCloseTo(expectedRaroc, 3);
      }
    }
  });

  it('should classify RAROC verdict as ACCRETIVE (>12%), NEUTRAL (5-12%), or DESTRUCTIVE (<5%)', async () => {
    const result = await service.getFullAttribution('inst-1');

    for (const r of result.rarocRanking) {
      if (r.raroc > 0.12) expect(r.verdict).toBe('ACCRETIVE');
      else if (r.raroc >= 0.05) expect(r.verdict).toBe('NEUTRAL');
      else expect(r.verdict).toBe('DESTRUCTIVE');
    }
  });

  it('should sort RAROC rankings from highest to lowest', async () => {
    const result = await service.getFullAttribution('inst-1');

    for (let i = 1; i < result.rarocRanking.length; i++) {
      expect(result.rarocRanking[i - 1].raroc).toBeGreaterThanOrEqual(
        result.rarocRanking[i].raroc,
      );
    }
  });
});
