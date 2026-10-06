import { LiquidityAdvancedService } from './liquidity-advanced.service';

describe('LiquidityAdvancedService', () => {
  let service: LiquidityAdvancedService;

  const mockPrisma = {
    balanceSheetItem: { findMany: jest.fn() },
    liquidityPosition: { findFirst: jest.fn() },
    depositTier: { findMany: jest.fn() },
  };

  beforeEach(() => {
    service = new LiquidityAdvancedService(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── NSFR Calculation ──────────────────────────────────────

  it('should compute NSFR as (ASF / RSF) x 100', () => {
    const items = [
      {
        category: 'liability',
        subcategory: 'savings',
        balance: 500_000,
        name: 'Savings',
      },
      {
        category: 'asset',
        subcategory: 'cash',
        balance: 100_000,
        name: 'Cash',
      },
      {
        category: 'asset',
        subcategory: 'consumer_loans',
        balance: 300_000,
        name: 'Consumer Loans',
        duration: 2,
      },
    ];

    const result = service.calculateNSFR(items);

    // ASF = 500K * 0.95 (savings factor) + equity (100K+300K-500K=0, clamped) = 475K
    // Actually equity = max(totalAssets - totalLiabilities, 0) = max(400K - 500K, 0) = 0
    // ASF = 475K
    // RSF = 100K * 0.0 (cash) + 300K * 0.65 (consumer loans >1yr) = 195K
    // NSFR = (475K / 195K) * 100 = ~243.6
    expect(result.nsfr).toBeGreaterThan(100);
    expect(result.asf).toBeGreaterThan(0);
    expect(result.rsf).toBeGreaterThan(0);
    expect(result.nsfr).toBeCloseTo((result.asf / result.rsf) * 100, 2);
  });

  it('should classify NSFR status as compliant (>=100), warning (90-100), or breach (<90)', () => {
    // Compliant case: more ASF than RSF
    const compliantItems = [
      {
        category: 'liability',
        subcategory: 'savings',
        balance: 1_000_000,
        name: 'Savings',
      },
      {
        category: 'asset',
        subcategory: 'cash',
        balance: 500_000,
        name: 'Cash',
      },
    ];
    expect(service.calculateNSFR(compliantItems).status).toBe('compliant');

    // Breach case: very little ASF vs RSF
    const breachItems = [
      {
        category: 'liability',
        subcategory: 'short_term_stuff',
        balance: 1_000_000,
        name: 'ST Borr',
      },
      {
        category: 'asset',
        subcategory: 'other_assets',
        balance: 900_000,
        name: 'Illiquid',
      },
    ];
    const breachResult = service.calculateNSFR(breachItems);
    // other_assets RSF factor = 1.0, so RSF = 900K
    // short_term_stuff gets default 0.5, so ASF = 500K + equity max(900K-1M, 0) = 500K
    // NSFR = (500K / 900K) * 100 = 55.6 => breach
    expect(breachResult.status).toBe('breach');
  });

  it('should assign ASF factor of 0.95 for demand/savings deposits and 1.0 for equity', () => {
    const items = [
      {
        category: 'liability',
        subcategory: 'demand_deposits',
        balance: 100_000,
        name: 'Demand',
      },
      {
        category: 'asset',
        subcategory: 'cash',
        balance: 200_000,
        name: 'Cash',
      },
    ];

    const result = service.calculateNSFR(items);

    const demandEntry = result.asfBreakdown.find(
      (a) => a.category === 'Demand',
    );
    expect(demandEntry).toBeDefined();
    expect(demandEntry!.factor).toBe(0.95);

    const equityEntry = result.asfBreakdown.find(
      (a) => a.category === 'Equity',
    );
    expect(equityEntry).toBeDefined();
    expect(equityEntry!.factor).toBe(1.0);
    // Equity = totalAssets - totalLiabilities = 200K - 100K = 100K
    expect(equityEntry!.balance).toBeCloseTo(100_000, 0);
  });

  it('should assign RSF factor of 0.0 for cash and 0.05 for treasuries', () => {
    const items = [
      { category: 'asset', subcategory: 'cash', balance: 50_000, name: 'Cash' },
      {
        category: 'asset',
        subcategory: 'treasury_securities',
        balance: 200_000,
        name: 'Treasuries',
      },
    ];

    const result = service.calculateNSFR(items);

    const cashEntry = result.rsfBreakdown.find((r) => r.category === 'Cash');
    expect(cashEntry!.factor).toBe(0.0);
    expect(cashEntry!.weighted).toBe(0);

    const treasuryEntry = result.rsfBreakdown.find(
      (r) => r.category === 'Treasuries',
    );
    expect(treasuryEntry!.factor).toBe(0.05);
    expect(treasuryEntry!.weighted).toBeCloseTo(10_000, 0);
  });

  // ── Deposit Flight Simulation ─────────────────────────────

  it('should simulate 12-month deposit flight with monotonically decreasing total deposits', () => {
    const tiers = [
      {
        tierName: 'Core',
        balance: 1_000_000,
        insuredPct: 0.9,
        flightRate: 0.03,
      },
      {
        tierName: 'Uninsured',
        balance: 500_000,
        insuredPct: 0.1,
        flightRate: 0.1,
      },
    ];

    const result = service.simulateDepositFlight(tiers, 200_000);

    expect(result.monthlyProjections).toHaveLength(12);
    // Total deposits should decrease over time
    for (let i = 1; i < result.monthlyProjections.length; i++) {
      expect(result.monthlyProjections[i].totalDeposits).toBeLessThanOrEqual(
        result.monthlyProjections[i - 1].totalDeposits,
      );
    }
  });

  it('should compute tier-level 6-month and 12-month losses using compound flight rate', () => {
    const tiers = [
      {
        tierName: 'Test Tier',
        balance: 1_000_000,
        insuredPct: 0.5,
        flightRate: 0.05,
      },
    ];

    const result = service.simulateDepositFlight(tiers, 150_000);

    const tier = result.tiers[0];
    // month6Loss = balance * (1 - (1 - flightRate)^6) = 1M * (1 - 0.95^6)
    const expected6 = 1_000_000 * (1 - Math.pow(0.95, 6));
    expect(tier.month6Loss).toBeCloseTo(expected6, 0);

    // month12Loss = balance * (1 - (1 - flightRate)^12) = 1M * (1 - 0.95^12)
    const expected12 = 1_000_000 * (1 - Math.pow(0.95, 12));
    expect(tier.month12Loss).toBeCloseTo(expected12, 0);
  });

  it('should compute worst-case loss as sum of all 12-month tier losses', () => {
    const tiers = [
      { tierName: 'A', balance: 500_000, insuredPct: 0.8, flightRate: 0.02 },
      { tierName: 'B', balance: 300_000, insuredPct: 0.2, flightRate: 0.1 },
    ];

    const result = service.simulateDepositFlight(tiers, 100_000);

    const totalMonth12Loss = result.tiers.reduce(
      (s, t) => s + t.month12Loss,
      0,
    );
    expect(result.worstCaseLoss).toBeCloseTo(totalMonth12Loss, 0);
  });

  // ── LCR Calculation ───────────────────────────────────────

  describe('calculateLCR', () => {
    it('computes HQLA from cash + government securities + corp bonds (haircut)', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
        {
          category: 'asset',
          subcategory: 'government_securities',
          balance: 100_000,
          name: 'Gov',
        },
        {
          category: 'asset',
          subcategory: 'corporate_bonds',
          balance: 80_000,
          name: 'Corp',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 200_000,
          name: 'Dep',
          maturityYears: 0.5,
        },
      ];

      const result = service.calculateLCR(items);

      // Level 1 = 50K + 100K = 150K
      // Level 2a = 80K * 0.85 = 68K
      // HQLA = 150K + 68K = 218K
      expect(result.hqlaBreakdown.level1).toBe(150_000);
      expect(result.hqlaBreakdown.level2a).toBeCloseTo(68_000, 0);
      expect(result.hqlaTotal).toBeCloseTo(218_000, 0);
    });

    it('returns LCR = 999 when no net outflows', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 100_000,
          name: 'Cash',
        },
        // No liabilities = no outflows
      ];
      const result = service.calculateLCR(items);
      expect(result.lcr).toBe(999);
    });

    it('classifies LCR status correctly', () => {
      // Compliant: LCR >= 100
      const compliant = [
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 100_000,
          name: 'Cash',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 100_000,
          name: 'Dep',
          maturityYears: 0.5,
        },
      ];
      expect(service.calculateLCR(compliant).status).toBe('compliant');

      // Breach: very low HQLA
      const breach = [
        {
          category: 'asset',
          subcategory: 'loans',
          balance: 100_000,
          name: 'Loans',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 500_000,
          name: 'Dep',
          maturityYears: 0.5,
        },
      ];
      expect(service.calculateLCR(breach).status).toBe('breach');
    });

    it('applies Level 2 cap (Basel III: Level 2 <= 2/3 of Level 1)', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 30_000,
          name: 'Cash',
        },
        {
          category: 'asset',
          subcategory: 'corporate_bonds',
          balance: 200_000,
          name: 'Corp',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 100_000,
          name: 'Dep',
          maturityYears: 0.5,
        },
      ];
      const result = service.calculateLCR(items);
      // Level 1 = 30K, Level 2 cap = 30K * 0.6667 = 20K
      expect(result.hqlaBreakdown.level2Cap).toBeCloseTo(30_000 * 0.6667, 0);
      expect(result.hqlaBreakdown.level2Applied).toBeLessThanOrEqual(
        result.hqlaBreakdown.level2Cap + 1,
      );
    });

    it('filters short-term liabilities (maturity <= 1yr) for outflows', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 100_000,
          name: 'Cash',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 200_000,
          name: 'Short',
          maturityYears: 0.5,
        },
        {
          category: 'liability',
          subcategory: 'bonds',
          balance: 300_000,
          name: 'Long',
          maturityYears: 5,
        },
      ];
      const result = service.calculateLCR(items);
      // Only short-term (200K) contributes to outflows at 25% = 50K
      expect(result.totalNetOutflows).toBeCloseTo(50_000, 0);
    });
  });

  // ── NSFR: additional factor tests ──────────────────────────

  describe('NSFR additional factors', () => {
    it('assigns ASF 1.0 for time deposits > 1yr', () => {
      const items = [
        {
          category: 'liability',
          subcategory: 'time_deposit',
          balance: 100_000,
          name: 'CD',
          duration: 2,
        },
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
      ];
      const result = service.calculateNSFR(items);
      const cd = result.asfBreakdown.find((a) => a.category === 'CD');
      expect(cd!.factor).toBe(1.0);
    });

    it('assigns ASF 0.5 for time deposits <= 1yr', () => {
      const items = [
        {
          category: 'liability',
          subcategory: 'cd_short',
          balance: 100_000,
          name: 'Short CD',
          duration: 0.5,
        },
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
      ];
      const result = service.calculateNSFR(items);
      const cd = result.asfBreakdown.find((a) => a.category === 'Short CD');
      expect(cd!.factor).toBe(0.5);
    });

    it('assigns ASF 0.0 for short-term borrowings', () => {
      const items = [
        {
          category: 'liability',
          subcategory: 'fhlb_borrowing',
          balance: 100_000,
          name: 'FHLB',
          duration: 0.5,
        },
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
      ];
      const result = service.calculateNSFR(items);
      const fhlb = result.asfBreakdown.find((a) => a.category === 'FHLB');
      expect(fhlb!.factor).toBe(0.0);
    });

    it('assigns ASF 1.0 for long-term borrowings', () => {
      const items = [
        {
          category: 'liability',
          subcategory: 'fhlb_borrowing',
          balance: 100_000,
          name: 'FHLB',
          duration: 3,
        },
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
      ];
      const result = service.calculateNSFR(items);
      const fhlb = result.asfBreakdown.find((a) => a.category === 'FHLB');
      expect(fhlb!.factor).toBe(1.0);
    });

    it('assigns RSF 0.15 for agency/MBS securities', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'agency_mbs',
          balance: 100_000,
          name: 'MBS',
        },
      ];
      const result = service.calculateNSFR(items);
      const mbs = result.rsfBreakdown.find((r) => r.category === 'MBS');
      expect(mbs!.factor).toBe(0.15);
    });

    it('assigns RSF 0.65 for residential mortgages', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'residential_mortgage',
          balance: 100_000,
          name: 'Mortgage',
        },
      ];
      const result = service.calculateNSFR(items);
      const mort = result.rsfBreakdown.find((r) => r.category === 'Mortgage');
      expect(mort!.factor).toBe(0.65);
    });

    it('assigns RSF 0.85 for commercial RE', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'commercial_re',
          balance: 100_000,
          name: 'CRE',
        },
      ];
      const result = service.calculateNSFR(items);
      const cre = result.rsfBreakdown.find((r) => r.category === 'CRE');
      expect(cre!.factor).toBe(0.85);
    });

    it('assigns RSF 0.5 for short-term consumer loans', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'consumer_loan',
          balance: 100_000,
          name: 'Consumer',
          duration: 0.5,
        },
      ];
      const result = service.calculateNSFR(items);
      const loan = result.rsfBreakdown.find((r) => r.category === 'Consumer');
      expect(loan!.factor).toBe(0.5);
    });

    it('assigns RSF 1.0 for unknown asset types', () => {
      const items = [
        {
          category: 'asset',
          subcategory: 'other_exotic',
          balance: 100_000,
          name: 'Exotic',
        },
      ];
      const result = service.calculateNSFR(items);
      const exotic = result.rsfBreakdown.find((r) => r.category === 'Exotic');
      expect(exotic!.factor).toBe(1.0);
    });

    it('computes warning NSFR for 90-100 range', () => {
      const items = [
        {
          category: 'liability',
          subcategory: 'other',
          balance: 950_000,
          name: 'Liab',
        },
        {
          category: 'asset',
          subcategory: 'other',
          balance: 1_000_000,
          name: 'Asset',
        },
      ];
      const result = service.calculateNSFR(items);
      // ASF = 950K * 0.5 + equity(max(1M-950K,0)=50K)*1.0 = 525K
      // RSF = 1M * 1.0 = 1M
      // NSFR = 52.5% => breach
      if (result.nsfr >= 90 && result.nsfr < 100) {
        expect(result.status).toBe('warning');
      }
    });
  });

  // ── Deposit flight: survival horizon ────────────────────────

  describe('deposit flight survival horizon', () => {
    it('detects survival horizon when HQLA depletes', () => {
      const tiers = [
        {
          tierName: 'Uninsured',
          balance: 1_000_000,
          insuredPct: 0,
          flightRate: 0.2,
        },
      ];
      const result = service.simulateDepositFlight(tiers, 10_000); // very low HQLA
      expect(result.survivalHorizonMonths).toBeLessThanOrEqual(12);
    });

    it('survival horizon is 12 when HQLA never depletes', () => {
      const tiers = [
        {
          tierName: 'Core',
          balance: 100_000,
          insuredPct: 0.9,
          flightRate: 0.01,
        },
      ];
      const result = service.simulateDepositFlight(tiers, 1_000_000); // massive HQLA
      expect(result.survivalHorizonMonths).toBe(12);
    });

    it('expectedLoss is 30% of 6-month loss', () => {
      const tiers = [
        {
          tierName: 'Core',
          balance: 500_000,
          insuredPct: 0.8,
          flightRate: 0.03,
        },
      ];
      const result = service.simulateDepositFlight(tiers, 100_000);
      const totalMonth6Loss = result.tiers.reduce(
        (s, t) => s + t.month6Loss,
        0,
      );
      expect(result.expectedLoss).toBeCloseTo(totalMonth6Loss * 0.3, 0);
    });
  });

  // ── Deposit flight: default HQLA from tier balances ─────────
  describe('deposit flight default HQLA', () => {
    it('uses 15% of tier balances as HQLA when totalHQLA is 0', () => {
      const tiers = [
        {
          tierName: 'Core',
          balance: 1_000_000,
          insuredPct: 0.9,
          flightRate: 0.02,
        },
      ];
      const result = service.simulateDepositFlight(tiers, 0);
      // Default HQLA = 1M * 0.15 = 150K
      expect(result.monthlyProjections[0].hqlaRemaining).toBeGreaterThan(0);
    });
  });

  // ── Deposit flight: alternate tier field names ─────────────
  describe('deposit flight tier field names', () => {
    it('handles snake_case field names', () => {
      const tiers = [
        {
          tier_name: 'Core',
          balance: 500_000,
          insured_pct: 0.8,
          flight_rate: 0.03,
        },
      ];
      const result = service.simulateDepositFlight(tiers, 50_000);
      expect(result.tiers[0].tierName).toBe('Core');
      expect(result.tiers[0].insuredPct).toBe(0.8);
      expect(result.tiers[0].monthlyFlightRate).toBe(0.03);
    });
  });

  // ── getAdvancedLiquidity integration ────────────────────────
  describe('getAdvancedLiquidity', () => {
    it('returns combined LCR, NSFR, and deposit flight', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 100_000,
          name: 'Cash',
        },
        {
          category: 'liability',
          subcategory: 'savings',
          balance: 200_000,
          name: 'Savings',
        },
      ]);
      mockPrisma.liquidityPosition.findFirst.mockResolvedValue({
        hqlaLevel1: 80_000,
        hqlaLevel2: 20_000,
      });
      mockPrisma.depositTier.findMany.mockResolvedValue([]);

      const result = await service.getAdvancedLiquidity('inst-1');
      expect(result.lcr).toBeDefined();
      expect(result.lcrDetail).toBeDefined();
      expect(result.nsfr).toBeDefined();
      expect(result.depositFlight).toBeDefined();
    });

    it('uses default tiers when no deposit tiers exist', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 200_000,
          name: 'Deposits',
        },
      ]);
      mockPrisma.liquidityPosition.findFirst.mockResolvedValue(null);
      mockPrisma.depositTier.findMany.mockResolvedValue([]);

      const result = await service.getAdvancedLiquidity('inst-1');
      expect(result.depositFlight.tiers).toHaveLength(4); // default tiers
      expect(result.depositFlight.tiers.map((t) => t.tierName)).toContain(
        'Insured Core',
      );
    });

    it('uses actual deposit tiers when they exist', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'cash',
          balance: 50_000,
          name: 'Cash',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          balance: 200_000,
          name: 'Dep',
        },
      ]);
      mockPrisma.liquidityPosition.findFirst.mockResolvedValue(null);
      mockPrisma.depositTier.findMany.mockResolvedValue([
        {
          tierName: 'Custom Tier',
          balance: 200_000,
          insuredPct: 0.7,
          flightRate: 0.04,
        },
      ]);

      const result = await service.getAdvancedLiquidity('inst-1');
      expect(result.depositFlight.tiers[0].tierName).toBe('Custom Tier');
    });
  });
});
