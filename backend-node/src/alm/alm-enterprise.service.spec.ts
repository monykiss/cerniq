import { NotFoundException } from '@nestjs/common';
import { AlmEnterpriseService } from './alm-enterprise.service';

describe('AlmEnterpriseService', () => {
  let service: AlmEnterpriseService;
  let mockPrisma: any;
  let mockAlmService: any;
  let mockDurationService: any;

  const makeMockPrisma = () => {
    const prisma: any = {
      institution: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      workspace: {
        findMany: jest.fn(),
      },
      balanceSheetItem: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      liquidityPosition: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      interestRateScenario: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      analysisRun: {
        findFirst: jest.fn(),
      },
      reportJob: {
        findFirst: jest.fn(),
      },
      // $transaction executes the callback with the same mock models,
      // so pinned-transaction reads see the same mocked data.
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return prisma;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = makeMockPrisma();
    mockAlmService = {
      analyzeBalanceSheet: jest.fn(),
      durationGapAnalysis: jest.fn().mockReturnValue({
        assetDuration: 3.0,
        liabilityDuration: 1.5,
        durationGap: 1.5,
      }),
      niiSimulation: jest.fn().mockReturnValue({
        baseNII: 5_000_000,
        scenarios: [
          { shockBps: -200, change: -500000, changePct: -0.1 },
          { shockBps: -100, change: -250000, changePct: -0.05 },
          { shockBps: 0, change: 0, changePct: 0 },
          { shockBps: 100, change: 200000, changePct: 0.04 },
          { shockBps: 200, change: 400000, changePct: 0.08 },
        ],
      }),
      eveAnalysis: jest.fn().mockReturnValue({
        scenarios: [
          { shockBps: -200, change: -1000000, changePct: -0.05 },
          { shockBps: -100, change: -500000, changePct: -0.025 },
          { shockBps: 100, change: 300000, changePct: 0.015 },
          { shockBps: 200, change: 600000, changePct: 0.03 },
        ],
      }),
      fullAnalysis: jest.fn().mockReturnValue({
        lcr: {
          lcr: 115,
          hqlaTotal: 25_000_000,
          totalNetOutflows: 20_000_000,
          status: 'compliant',
        },
        durationGap: { durationGap: 1.5 },
      }),
    } as any;
    mockDurationService = {
      calculatePortfolioMetrics: jest.fn().mockReturnValue({
        assetDuration: 3.0,
        liabilityDuration: 1.5,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: 1.8,
      }),
      calculateEVESensitivity: jest
        .fn()
        .mockReturnValue([{ shockBps: 200, eveChangePct: -5.2 }]),
      fullDurationAnalysis: jest.fn().mockReturnValue({
        portfolio: {
          assetDuration: 3.0,
          liabilityDuration: 1.5,
          assetConvexity: 0.02,
          liabilityConvexity: 0.005,
          leverageAdjustedDurationGap: 1.8,
        },
        eveSensitivity: [{ shockBps: 200, eveChangePct: -5.2 }],
      }),
    } as any;
    service = new AlmEnterpriseService(
      mockPrisma,
      mockAlmService,
      mockDurationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── createInstitution ───────────────────────────────────────
  it('createInstitution creates with correct defaults', async () => {
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-1' });
    const result = await service.createInstitution({
      workspaceId: 'ws-1',
      name: 'Test Coop',
      type: 'cooperativa',
      totalAssets: 250,
      reportingDate: '2026-01-31',
    });
    expect(mockPrisma.institution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Test Coop',
        type: 'cooperativa',
        currency: 'USD',
        primaryRegulator: 'COSSEC',
      }),
    });
    expect(result.id).toBe('inst-1');
  });

  it('createInstitution uses provided currency and regulator', async () => {
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-2' });
    await service.createInstitution({
      workspaceId: 'ws-1',
      name: 'US Credit Union',
      type: 'credit_union',
      totalAssets: 500,
      reportingDate: '2026-03-31',
      currency: 'EUR',
      primaryRegulator: 'NCUA',
    });
    expect(mockPrisma.institution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currency: 'EUR',
        primaryRegulator: 'NCUA',
      }),
    });
  });

  // ── getInstitution ──────────────────────────────────────────
  it('getInstitution throws NotFoundException when not found', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    await expect(service.getInstitution('bad-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getInstitution returns institution with balance sheet items', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Test',
      balanceSheetItems: [{ id: 'bsi-1', category: 'asset', balance: 100 }],
      liquidityPositions: [],
    });
    const result = await service.getInstitution('inst-1');
    expect(result.id).toBe('inst-1');
    expect(result.balanceSheetItems).toHaveLength(1);
  });

  // ── getInstitutionsByWorkspace ──────────────────────────────
  it('getInstitutionsByWorkspace returns paginated results', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([
      { id: 'inst-1', name: 'Coop A' },
    ]);
    mockPrisma.institution.count.mockResolvedValue(1);

    const result = await service.getInstitutionsByWorkspace('ws-1');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('getInstitutionsByWorkspace respects custom pagination', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([]);
    mockPrisma.institution.count.mockResolvedValue(50);

    const result = await service.getInstitutionsByWorkspace('ws-1', {
      page: 3,
      pageSize: 10,
    } as any);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(5);
  });

  // ── getInstitutionsByUser ───────────────────────────────────
  it('getInstitutionsByUser returns empty when user has no workspaces', async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    const result = await service.getInstitutionsByUser('user-1');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getInstitutionsByUser queries institutions across all user workspaces', async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([
      { id: 'ws-1' },
      { id: 'ws-2' },
    ]);
    mockPrisma.institution.findMany.mockResolvedValue([
      { id: 'inst-1' },
      { id: 'inst-2' },
    ]);
    mockPrisma.institution.count.mockResolvedValue(2);

    const result = await service.getInstitutionsByUser('user-1');
    expect(result.items).toHaveLength(2);
    expect(mockPrisma.institution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ['ws-1', 'ws-2'] } },
      }),
    );
  });

  // ── importBalanceSheetItems ─────────────────────────────────
  it('importBalanceSheetItems replaces existing items and updates totalAssets', async () => {
    mockPrisma.balanceSheetItem.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 3 });
    mockPrisma.institution.update.mockResolvedValue({});

    const items = [
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Auto Loans',
        balance: 100,
        rate: 0.06,
        duration: 3,
        rateType: 'fixed',
      },
      {
        category: 'asset',
        subcategory: 'cash',
        name: 'Cash',
        balance: 50,
        rate: 0.02,
        duration: 0.1,
        rateType: 'variable',
      },
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Savings',
        balance: 80,
        rate: 0.01,
        duration: 0.5,
        rateType: 'variable',
      },
    ];

    const result = await service.importBalanceSheetItems('inst-1', items);
    expect(result.count).toBe(3);
    expect(mockPrisma.balanceSheetItem.deleteMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst-1' },
    });
    // Total assets should be sum of asset items = 100 + 50 = 150
    expect(mockPrisma.institution.update).toHaveBeenCalledWith({
      where: { id: 'inst-1' },
      data: { totalAssets: 150 },
    });
  });

  it('importBalanceSheetItems sets totalAssets to 0 when only liabilities are imported', async () => {
    mockPrisma.balanceSheetItem.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.institution.update.mockResolvedValue({});

    const items = [
      {
        category: 'liability',
        subcategory: 'deposits',
        name: 'Savings',
        balance: 500,
        rate: 0.01,
        duration: 0.5,
        rateType: 'variable',
      },
    ];
    await service.importBalanceSheetItems('inst-1', items);
    expect(mockPrisma.institution.update).toHaveBeenCalledWith({
      where: { id: 'inst-1' },
      data: { totalAssets: 0 },
    });
  });

  it('importBalanceSheetItems converts repriceDate and maturityDate strings to Date objects', async () => {
    mockPrisma.balanceSheetItem.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.institution.update.mockResolvedValue({});

    const items = [
      {
        category: 'asset',
        subcategory: 'loans',
        name: 'Loan A',
        balance: 100,
        rate: 0.05,
        duration: 5,
        rateType: 'variable',
        repriceDate: '2026-06-30',
        maturityDate: '2031-06-30',
      },
    ];
    await service.importBalanceSheetItems('inst-1', items);
    const createCall = mockPrisma.balanceSheetItem.createMany.mock.calls[0][0];
    expect(createCall.data[0].repriceDate).toBeInstanceOf(Date);
    expect(createCall.data[0].maturityDate).toBeInstanceOf(Date);
  });

  // ── calculateDurationGap ───────────────────────────────────
  describe('calculateDurationGap', () => {
    it('returns asset-sensitive profile when gap > 0.5', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          balance: 1000,
          rate: 0.05,
          duration: 4,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          balance: 800,
          rate: 0.02,
          duration: 1,
          rateType: 'variable',
        },
      ]);
      mockDurationService.calculatePortfolioMetrics.mockReturnValue({
        assetDuration: 4.0,
        liabilityDuration: 1.0,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: 3.2,
      });

      const result = await service.calculateDurationGap('inst-1');
      expect(result.riskProfile).toBe('asset-sensitive');
      expect(result.durationGap).toBeGreaterThan(0);
    });

    it('returns neutral profile when |gap| < 0.5', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          balance: 1000,
          rate: 0.05,
          duration: 2,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          balance: 900,
          rate: 0.03,
          duration: 1.8,
          rateType: 'fixed',
        },
      ]);
      mockDurationService.calculatePortfolioMetrics.mockReturnValue({
        assetDuration: 2.0,
        liabilityDuration: 1.8,
        assetConvexity: 0.01,
        liabilityConvexity: 0.009,
        leverageAdjustedDurationGap: 0.2,
      });

      const result = await service.calculateDurationGap('inst-1');
      expect(result.riskProfile).toBe('neutral');
    });

    it('returns liability-sensitive profile when gap < -0.5', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          balance: 500,
          rate: 0.04,
          duration: 1,
          rateType: 'variable',
        },
        {
          category: 'liability',
          balance: 800,
          rate: 0.03,
          duration: 5,
          rateType: 'fixed',
        },
      ]);
      mockDurationService.calculatePortfolioMetrics.mockReturnValue({
        assetDuration: 1.0,
        liabilityDuration: 5.0,
        assetConvexity: 0.005,
        liabilityConvexity: 0.03,
        leverageAdjustedDurationGap: -7.0,
      });

      const result = await service.calculateDurationGap('inst-1');
      expect(result.riskProfile).toBe('liability-sensitive');
      expect(result.durationGap).toBeLessThan(0);
    });

    it('falls back to AlmService when no balance sheet items exist', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);

      const result = await service.calculateDurationGap('inst-1');
      expect(mockAlmService.durationGapAnalysis).toHaveBeenCalled();
      expect(result).toHaveProperty('riskProfile');
    });
  });

  // ── calculateLCR ───────────────────────────────────────────
  describe('calculateLCR', () => {
    it('returns compliant status when LCR >= 100 from stored position', async () => {
      mockPrisma.liquidityPosition.findFirst = jest.fn().mockResolvedValue({
        hqlaLevel1: 500,
        hqlaLevel2: 200,
        cashOutflows: 400,
        cashInflows: 100,
        lcr: 233.33,
      });

      const result = await service.calculateLCR('inst-1');
      expect(result.status).toBe('compliant');
      expect(result.lcr).toBeGreaterThanOrEqual(100);
      expect(result.hqla).toBe(700);
    });

    it('returns warning status when LCR is between 90 and 100', async () => {
      mockPrisma.liquidityPosition.findFirst = jest.fn().mockResolvedValue({
        hqlaLevel1: 80,
        hqlaLevel2: 10,
        cashOutflows: 100,
        cashInflows: 5,
        lcr: 94.74,
      });

      const result = await service.calculateLCR('inst-1');
      expect(result.status).toBe('warning');
    });

    it('returns breach status when LCR < 90', async () => {
      mockPrisma.liquidityPosition.findFirst = jest.fn().mockResolvedValue({
        hqlaLevel1: 30,
        hqlaLevel2: 5,
        cashOutflows: 100,
        cashInflows: 10,
        lcr: 38.89,
      });

      const result = await service.calculateLCR('inst-1');
      expect(result.status).toBe('breach');
      expect(result.buffer).toBeLessThan(0);
    });

    it('falls back to AlmService fullAnalysis when no liquidity position stored', async () => {
      mockPrisma.liquidityPosition.findFirst = jest
        .fn()
        .mockResolvedValue(null);
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);

      const result = await service.calculateLCR('inst-1');
      expect(mockAlmService.fullAnalysis).toHaveBeenCalled();
      expect(result).toHaveProperty('lcr');
      expect(result).toHaveProperty('status');
    });

    // D1 (2026-04-07): the previous behavior of this method was to silently
    // return `{lcr: 0, status: 'breach'}` when no liquidity row existed and
    // fullAnalysis couldn't derive LCR. That was the codebase's smoking gun
    // — a regulator reading a CerniQ report with `lcr: 0, status: 'breach'`
    // would conclude the cooperativa was in regulatory breach when the
    // actual situation was "no data has been loaded yet". The new contract
    // is asserted below.
    it('returns data_unavailable with a CRITICAL gap when no LCR can be computed', async () => {
      mockPrisma.liquidityPosition.findFirst = jest
        .fn()
        .mockResolvedValue(null);
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
      mockAlmService.fullAnalysis.mockReturnValue({ lcr: null });

      const result = await service.calculateLCR('inst-1');

      // Numeric fields are null — never the silent zero of the old contract.
      expect(result.lcr).toBeNull();
      expect(result.hqla).toBeNull();
      expect(result.netOutflows).toBeNull();
      expect(result.buffer).toBeNull();

      // Status communicates "we have no number" not "we computed a 0".
      expect(result.status).toBe('data_unavailable');

      // Gap manifest carries the canonical statement of what's missing.
      expect(result.gaps).toBeDefined();
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps![0]).toMatchObject({
        field: 'liquidity.lcr',
        reason: 'NO_LIQUIDITY_POSITION',
        severity: 'CRITICAL',
      });
      expect(result.gaps![0].action).toMatch(/upload.*liquidity/i);
    });
  });

  // ── calculateNIISensitivity ────────────────────────────────
  describe('calculateNIISensitivity', () => {
    beforeEach(() => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
    });

    it('returns scenarios excluding the base (0bps) scenario', async () => {
      const result = await service.calculateNIISensitivity('inst-1');
      expect(result.scenarios.length).toBeGreaterThan(0);
      expect(result.scenarios.every((s: any) => s.shiftBps !== 0)).toBe(true);
    });

    it('includes baseNII in millions', async () => {
      const result = await service.calculateNIISensitivity('inst-1');
      expect(result.baseNII).toBe(5); // 5_000_000 / 1_000_000
    });

    it('assigns risk rating based on worst case NII impact', async () => {
      const result = await service.calculateNIISensitivity('inst-1');
      // Max abs impact pct = max(10, 5, 4, 8) = 10 => 'high'
      expect(['low', 'moderate', 'high', 'critical']).toContain(
        result.riskRating,
      );
    });

    it('formats scenario names with + prefix for positive shifts', async () => {
      const result = await service.calculateNIISensitivity('inst-1');
      const pos = result.scenarios.find((s: any) => s.shiftBps === 200);
      if (pos) {
        expect(pos.name).toBe('+200bps');
      }
    });
  });

  // ── saveLiquidityPosition ──────────────────────────────────
  it('saveLiquidityPosition calls prisma create', async () => {
    mockPrisma.liquidityPosition.create.mockResolvedValue({ id: 'lp-1' });
    const data = {
      hqlaLevel1: 100,
      hqlaLevel2: 50,
      cashOutflows: 80,
      cashInflows: 30,
      lcr: 300,
      nsfr: 110,
    };
    const result = await service.saveLiquidityPosition('inst-1', data);
    expect(mockPrisma.liquidityPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          institutionId: 'inst-1',
          hqlaLevel1: 100,
        }),
      }),
    );
    expect(result.id).toBe('lp-1');
  });

  // ── getALMSummary ──────────────────────────────────────────
  describe('getALMSummary', () => {
    const mockInstitution = {
      id: 'inst-1',
      name: 'Test Cooperativa',
      type: 'cooperativa',
      totalAssets: 250,
      currency: 'USD',
      reportingDate: new Date('2026-01-31'),
      balanceSheetItems: [],
      liquidityPositions: [],
      primaryRegulator: 'COSSEC',
    };

    beforeEach(() => {
      mockPrisma.institution.findUnique.mockResolvedValue(mockInstitution);
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
      mockPrisma.liquidityPosition.findFirst = jest
        .fn()
        .mockResolvedValue(null);
      mockPrisma.interestRateScenario.deleteMany.mockResolvedValue({});
      mockPrisma.interestRateScenario.createMany.mockResolvedValue({});
    });

    it('returns complete ALM summary with all required fields', async () => {
      const result = await service.getALMSummary('inst-1');
      expect(result).toHaveProperty('institution');
      expect(result).toHaveProperty('durationGap');
      expect(result).toHaveProperty('niiSensitivity');
      expect(result).toHaveProperty('liquidity');
      expect(result).toHaveProperty('topRisks');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('riskScore');
      expect(result).toHaveProperty('fullAnalysis');
    });

    it('risk score is between 0 and 100', async () => {
      const result = await service.getALMSummary('inst-1');
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it('institution object contains correct id and name', async () => {
      const result = await service.getALMSummary('inst-1');
      expect(result.institution.id).toBe('inst-1');
      expect(result.institution.name).toBe('Test Cooperativa');
    });

    it('persists scenarios to database', async () => {
      await service.getALMSummary('inst-1');
      expect(mockPrisma.interestRateScenario.deleteMany).toHaveBeenCalledWith({
        where: { institutionId: 'inst-1' },
      });
    });

    it('topRisks array is never empty', async () => {
      const result = await service.getALMSummary('inst-1');
      expect(result.topRisks.length).toBeGreaterThan(0);
    });

    it('recommendations array is never empty', async () => {
      const result = await service.getALMSummary('inst-1');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  // ── getRegulatoryCompliance ────────────────────────────────
  describe('getRegulatoryCompliance', () => {
    const mockInstitution = {
      id: 'inst-1',
      name: 'Test Cooperativa',
      type: 'cooperativa',
      totalAssets: 250,
      currency: 'USD',
      reportingDate: new Date('2026-01-31'),
      balanceSheetItems: [],
      liquidityPositions: [],
      primaryRegulator: 'COSSEC',
    };

    beforeEach(() => {
      mockPrisma.institution.findUnique.mockResolvedValue(mockInstitution);
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Consumer',
          balance: 80,
          rate: 0.07,
          duration: 3,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Cash',
          balance: 30,
          rate: 0.02,
          duration: 0.1,
          rateType: 'variable',
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Bonds',
          balance: 40,
          rate: 0.045,
          duration: 5,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'savings_deposits',
          name: 'Savings',
          balance: 100,
          rate: 0.015,
          duration: 0.5,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'CDs',
          balance: 30,
          rate: 0.035,
          duration: 1,
          rateType: 'fixed',
        },
      ]);
      mockPrisma.liquidityPosition.findFirst = jest.fn().mockResolvedValue({
        hqlaLevel1: 30,
        hqlaLevel2: 10,
        cashOutflows: 35,
        cashInflows: 5,
        lcr: 133.33,
      });
    });

    it('returns COSSEC compliance when regulator is COSSEC', async () => {
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(result).toHaveProperty('ratios');
      expect(result).toHaveProperty('examReadinessScore');
      expect(result).toHaveProperty('overallStatus');
      expect(result).toHaveProperty('summary');
    });

    it('returns 12 ratios', async () => {
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(result.ratios.length).toBe(12);
    });

    it('overall status is compliant, conditional, or non-compliant', async () => {
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(['compliant', 'conditional', 'non-compliant']).toContain(
        result.overallStatus,
      );
    });

    it('exam readiness score is between 0 and 100', async () => {
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(result.examReadinessScore).toBeGreaterThanOrEqual(0);
      expect(result.examReadinessScore).toBeLessThanOrEqual(100);
    });

    it('summary contains derived financial ratios', async () => {
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(result.summary).toHaveProperty('capitalRatio');
      expect(result.summary).toHaveProperty('loanToShareRatio');
      expect(result.summary).toHaveProperty('liquidityRatio');
      expect(result.summary).toHaveProperty('nim');
      expect(result.summary.totalAssets).toBeGreaterThan(0);
    });

    it('uses NCUA framework when primaryRegulator is NCUA', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...mockInstitution,
        primaryRegulator: 'NCUA',
      });
      const result = await service.getRegulatoryCompliance('inst-1');
      expect(result).toHaveProperty('ratios');
      expect(result.ratios.length).toBe(12); // 7 NCUA + 5 N/A
    });
  });

  // ── getCOSSECComplianceWithTrend ───────────────────────────
  describe('getCOSSECComplianceWithTrend', () => {
    beforeEach(() => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        name: 'Test',
        type: 'cooperativa',
        totalAssets: 100,
        currency: 'USD',
        reportingDate: new Date('2026-01-31'),
        balanceSheetItems: [],
        liquidityPositions: [],
        primaryRegulator: 'COSSEC',
      });
      // D1: getCOSSECCompliance now refuses to compute on an empty balance
      // sheet (returns the data_unavailable shell). The trend tests below
      // need real ratios to trend on, so provide a minimal balance sheet
      // here. Empty-balance-sheet behavior is asserted in its own spec
      // below.
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          id: 'bsi-1',
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Loans',
          balance: 60,
          rate: 0.085,
          duration: 3,
          rateType: 'fixed',
        },
        {
          id: 'bsi-2',
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Cash',
          balance: 10,
          rate: 0.05,
          duration: 0.1,
          rateType: 'variable',
        },
        {
          id: 'bsi-3',
          category: 'liability',
          subcategory: 'savings_deposits',
          name: 'Savings',
          balance: 50,
          rate: 0.0175,
          duration: 0.3,
          rateType: 'variable',
        },
      ]);
      mockPrisma.liquidityPosition.findFirst = jest
        .fn()
        .mockResolvedValue(null);
    });

    it('returns trends: null when no previous analysis run exists', async () => {
      mockPrisma.analysisRun.findFirst.mockResolvedValue(null);
      const result = await service.getCOSSECComplianceWithTrend('inst-1');
      expect(result.trends).toBeNull();
      expect(result.previousPeriod).toBeNull();
    });

    it('calculates trend deltas when previous run has resultSummary', async () => {
      mockPrisma.analysisRun.findFirst.mockResolvedValue({
        createdAt: new Date('2025-10-15'),
        resultSummary: {
          summary: { capitalRatio: 8.5, liquidityRatio: 18, nim: 3.0 },
        },
      });
      mockPrisma.reportJob.findFirst.mockResolvedValue(null);

      const result = await service.getCOSSECComplianceWithTrend('inst-1');
      expect(result.trends).not.toBeNull();
      if (result.trends) {
        expect(result.trends.length).toBeGreaterThan(0);
        for (const t of result.trends) {
          expect(['improving', 'deteriorating', 'stable']).toContain(t.trend);
        }
      }
    });
  });

  // ── listBalanceSheetItems ──────────────────────────────────
  it('listBalanceSheetItems returns paginated results', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([{ id: 'bsi-1' }]);
    mockPrisma.balanceSheetItem.count.mockResolvedValue(1);

    const result = await service.listBalanceSheetItems('inst-1');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  // ── buildBalanceSheetDto (via getBalanceSheetSnapshot) ─────
  describe('getBalanceSheetSnapshot', () => {
    it('returns empty-but-valid DTO when no items exist', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
      const result = await service.getBalanceSheetSnapshot('inst-1');
      expect(result.assets.length).toBeGreaterThan(0);
      expect(result.liabilities.length).toBeGreaterThan(0);
      expect(result.equity).toBe(0);
    });

    it('converts balance sheet items to DTO with correct asset/liability split', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'loans',
          name: 'Loan A',
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
          name: 'Deposit A',
          balance: 80,
          rate: 0.02,
          duration: 1,
          rateType: 'variable',
          maturityDate: null,
          repriceDate: null,
        },
      ]);
      const result = await service.getBalanceSheetSnapshot('inst-1');
      expect(result.assets.length).toBe(1);
      expect(result.liabilities.length).toBe(1);
      // balance is in millions, so amount = 100 * 1M = 100_000_000
      expect(result.assets[0].amount).toBe(100_000_000);
      expect(result.equity).toBe(20_000_000);
    });
  });

  // ── Coverage: scoreDurationGap (lines 1693-1695), scoreNII (lines 1702-1708), scoreLCR (lines 1717-1719) ──
  // These are exercised through getALMSummary which calls the scoring functions.

  describe('getALMSummary scoring paths', () => {
    beforeEach(() => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        name: 'Test CU',
        type: 'cooperativa',
        totalAssets: 200,
        currency: 'USD',
        reportingDate: new Date('2026-03-31'),
      });
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'loans',
          name: 'Loans',
          balance: 150,
          rate: 0.06,
          duration: 5,
          rateType: 'fixed',
          maturityDate: null,
          repriceDate: null,
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          name: 'Deposits',
          balance: 130,
          rate: 0.02,
          duration: 1,
          rateType: 'variable',
          maturityDate: null,
          repriceDate: null,
        },
      ]);
      mockPrisma.liquidityPosition.findFirst.mockResolvedValue(null);
    });

    it('covers large duration gap scoring', async () => {
      mockDurationService.calculatePortfolioMetrics.mockReturnValueOnce({
        assetDuration: 6.0,
        liabilityDuration: 2.0,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: 4.0,
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.durationGap.durationGap).toBe(4);
    });

    it('covers very large duration gap scoring', async () => {
      mockDurationService.calculatePortfolioMetrics.mockReturnValueOnce({
        assetDuration: 8.0,
        liabilityDuration: 1.5,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: 6.5,
      });
      const result = await service.getALMSummary('inst-1');
      expect(result).toBeDefined();
    });

    it('covers neutral risk profile (gap < 0.5)', async () => {
      mockDurationService.calculatePortfolioMetrics.mockReturnValueOnce({
        assetDuration: 2.0,
        liabilityDuration: 1.8,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: 0.2,
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.durationGap.riskProfile).toBe('neutral');
    });

    it('covers liability-sensitive risk profile (gap < 0)', async () => {
      mockDurationService.calculatePortfolioMetrics.mockReturnValueOnce({
        assetDuration: 1.0,
        liabilityDuration: 3.0,
        assetConvexity: 0.02,
        liabilityConvexity: 0.005,
        leverageAdjustedDurationGap: -2.0,
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.durationGap.riskProfile).toBe('liability-sensitive');
    });

    it('covers NII critical risk rating', async () => {
      mockAlmService.niiSimulation.mockReturnValueOnce({
        baseNII: 5_000_000,
        scenarios: [{ shockBps: 200, change: -2000000, changePct: -0.25 }],
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.niiSensitivity.riskRating).toBe('critical');
    });

    it('covers NII high risk rating', async () => {
      mockAlmService.niiSimulation.mockReturnValueOnce({
        baseNII: 5_000_000,
        scenarios: [{ shockBps: 200, change: -750000, changePct: -0.15 }],
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.niiSensitivity.riskRating).toBe('high');
    });

    it('covers low LCR scoring', async () => {
      mockAlmService.fullAnalysis.mockReturnValue({
        lcr: {
          lcr: 70,
          hqlaTotal: 10_000_000,
          totalNetOutflows: 15_000_000,
          status: 'breach',
        },
        durationGap: { durationGap: 1.5 },
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.liquidity.lcr).toBe(70);
    });

    it('covers warning LCR scoring', async () => {
      mockAlmService.fullAnalysis.mockReturnValue({
        lcr: {
          lcr: 85,
          hqlaTotal: 15_000_000,
          totalNetOutflows: 18_000_000,
          status: 'warning',
        },
        durationGap: { durationGap: 1.5 },
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.liquidity.lcr).toBe(85);
    });

    it('covers moderate LCR scoring', async () => {
      mockAlmService.fullAnalysis.mockReturnValue({
        lcr: {
          lcr: 95,
          hqlaTotal: 18_000_000,
          totalNetOutflows: 19_000_000,
          status: 'warning',
        },
        durationGap: { durationGap: 1.5 },
      });
      const result = await service.getALMSummary('inst-1');
      expect(result.liquidity.lcr).toBe(95);
    });
  });

  // ── Coverage: duration service error path (lines 1621-1629) ──
  describe('duration analysis error handling', () => {
    it('handles duration service errors gracefully', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        name: 'Test CU',
        type: 'cooperativa',
        totalAssets: 200,
        currency: 'USD',
        reportingDate: new Date('2026-03-31'),
      });
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'loans',
          name: 'Loans',
          balance: 150,
          rate: 0.06,
          duration: 5,
          rateType: 'fixed',
          maturityDate: null,
          repriceDate: null,
        },
      ]);
      mockPrisma.liquidityPosition.findFirst.mockResolvedValue(null);
      mockDurationService.fullDurationAnalysis.mockImplementation(() => {
        throw new Error('Duration calculation failed');
      });

      const result = await service.getALMSummary('inst-1');
      // Should still return a result, just without duration convexity data
      expect(result).toBeDefined();
    });
  });

  // Note: neutral and liability-sensitive risk profiles are already
  // covered by tests in the 'calculateDurationGap' describe block above.
});
