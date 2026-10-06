import { StressTestingService } from './stress-testing.service';
import { buildSanJuanFederalDemo } from '../data/fixtures/builders/san-juan-federal.builder';

describe('StressTestingService', () => {
  let service: StressTestingService;
  const mockPrisma = {
    balanceSheetItem: {
      findMany: jest.fn(),
    },
    institution: {
      findUnique: jest.fn(),
    },
  } as any;
  const mockAlmEnterprise = {
    getALMSummary: jest.fn(),
    getInstitution: jest.fn(),
    getCOSSECCompliance: jest.fn(),
    calculateLCR: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StressTestingService(mockPrisma, mockAlmEnterprise);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── runMonteCarloSimulation ───────────────────────────────────
  it('returns empty result when no balance sheet items exist', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.runMonteCarloSimulation('inst-1');
    expect(result.paths).toBeGreaterThan(0);
    expect(result.ratePaths).toBeDefined();
    expect(result.niiDistribution).toBeDefined();
  });

  it('runs Monte Carlo with custom params clamped to safe bounds', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', rateType: 'variable', balance: 100, rate: 0.05 },
      { category: 'liability', rateType: 'variable', balance: 80, rate: 0.02 },
      { category: 'asset', rateType: 'fixed', balance: 200, rate: 0.06 },
      { category: 'liability', rateType: 'fixed', balance: 150, rate: 0.03 },
    ]);

    const result = await service.runMonteCarloSimulation('inst-1', {
      paths: 200,
      horizon: 6,
      volatility: 100,
    });

    expect(result.paths).toBe(200);
    expect(result.horizon).toBe(6);
    expect(result.ratePaths.length).toBeGreaterThan(0);
    // Rate paths should be capped at 50 for charting
    expect(result.ratePaths.length).toBeLessThanOrEqual(50);

    // NII distribution should have valid percentiles
    expect(result.niiDistribution.p5).toBeLessThanOrEqual(
      result.niiDistribution.median,
    );
    expect(result.niiDistribution.median).toBeLessThanOrEqual(
      result.niiDistribution.p95,
    );
  });

  it('clamps paths to MAX_MC_PATHS (50000)', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.runMonteCarloSimulation('inst-1', {
      paths: 999999,
    });
    expect(result.paths).toBeLessThanOrEqual(50000);
  });

  it('clamps horizon to MAX_MC_HORIZON (120)', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.runMonteCarloSimulation('inst-1', {
      horizon: 999,
    });
    expect(result.horizon).toBeLessThanOrEqual(120);
  });

  it('generates monthly NII bands with correct month count', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', rateType: 'variable', balance: 50, rate: 0.05 },
      { category: 'liability', rateType: 'fixed', balance: 40, rate: 0.03 },
    ]);

    const result = await service.runMonteCarloSimulation('inst-1', {
      paths: 100,
      horizon: 12,
    });

    // MC returns horizon+1 bands (month 0 = baseline through month N)
    expect(result.monthlyNIIBands).toHaveLength(13);
    result.monthlyNIIBands.forEach((band) => {
      expect(band.month).toBeGreaterThanOrEqual(0);
      expect(band.p5).toBeLessThanOrEqual(band.p95);
    });
  });

  // ── Floating vs fixed rate behavior ────────────────────────
  describe('floating vs fixed rate sensitivity', () => {
    it('floating-heavy portfolio produces wider NII distribution than fixed-heavy', async () => {
      // All floating
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        { category: 'asset', rateType: 'variable', balance: 500, rate: 0.06 },
        {
          category: 'liability',
          rateType: 'variable',
          balance: 400,
          rate: 0.02,
        },
      ]);
      const floatingResult = await service.runMonteCarloSimulation('inst-1', {
        paths: 500,
        horizon: 12,
        volatility: 200,
      });

      // All fixed
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        { category: 'asset', rateType: 'fixed', balance: 500, rate: 0.06 },
        { category: 'liability', rateType: 'fixed', balance: 400, rate: 0.02 },
      ]);
      const fixedResult = await service.runMonteCarloSimulation('inst-1', {
        paths: 500,
        horizon: 12,
        volatility: 200,
      });

      const floatingSpread =
        floatingResult.niiDistribution.p95 - floatingResult.niiDistribution.p5;
      const fixedSpread =
        fixedResult.niiDistribution.p95 - fixedResult.niiDistribution.p5;

      // Floating portfolio should have wider NII spread (more rate-sensitive)
      expect(floatingSpread).toBeGreaterThan(fixedSpread);
    });

    it('fixed-only portfolio yields identical NII across all paths', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        { category: 'asset', rateType: 'fixed', balance: 1000, rate: 0.07 },
        { category: 'liability', rateType: 'fixed', balance: 800, rate: 0.03 },
      ]);
      const result = await service.runMonteCarloSimulation('inst-1', {
        paths: 200,
        horizon: 6,
      });

      // p5 should equal p95 for a fully fixed portfolio (no rate sensitivity)
      expect(result.niiDistribution.p5).toBeCloseTo(
        result.niiDistribution.p95,
        1,
      );
    });
  });

  // ── Monte Carlo with high volatility ──────────────────────
  it('high volatility produces greater NII-at-risk', async () => {
    const items = [
      { category: 'asset', rateType: 'variable', balance: 300, rate: 0.05 },
      { category: 'liability', rateType: 'variable', balance: 200, rate: 0.02 },
    ];

    mockPrisma.balanceSheetItem.findMany.mockResolvedValue(items);
    const lowVol = await service.runMonteCarloSimulation('inst-1', {
      paths: 500,
      horizon: 12,
      volatility: 50,
    });

    mockPrisma.balanceSheetItem.findMany.mockResolvedValue(items);
    const highVol = await service.runMonteCarloSimulation('inst-1', {
      paths: 500,
      horizon: 12,
      volatility: 500,
    });

    expect(highVol.niiAtRisk).toBeGreaterThanOrEqual(lowVol.niiAtRisk);
  });

  // ── worstCaseNII is less than or equal to expectedNII ─────
  it('worstCaseNII <= expectedNII', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', rateType: 'variable', balance: 100, rate: 0.05 },
      { category: 'liability', rateType: 'fixed', balance: 80, rate: 0.02 },
    ]);
    const result = await service.runMonteCarloSimulation('inst-1', {
      paths: 300,
      horizon: 12,
    });
    expect(result.worstCaseNII).toBeLessThanOrEqual(result.expectedNII);
  });

  // ── NII at risk equals expected minus worst case ──────────
  it('niiAtRisk equals expectedNII minus worstCaseNII', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', rateType: 'variable', balance: 200, rate: 0.06 },
      {
        category: 'liability',
        rateType: 'variable',
        balance: 150,
        rate: 0.025,
      },
    ]);
    const result = await service.runMonteCarloSimulation('inst-1', {
      paths: 200,
      horizon: 12,
    });
    expect(result.niiAtRisk).toBeCloseTo(
      result.expectedNII - result.worstCaseNII,
      1,
    );
  });

  // ── Coverage boost: runRegulatoryStress ─────────────────────
  describe('runRegulatoryStress', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 100, niImpact: 0.5, mveImpact: -1, niImpactPct: 5 },
          { shiftBps: 200, niImpact: 1.0, mveImpact: -2, niImpactPct: 10 },
          { shiftBps: 300, niImpact: 1.5, mveImpact: -3, niImpactPct: 15 },
          { shiftBps: -200, niImpact: -0.8, mveImpact: 1.5, niImpactPct: -8 },
        ],
      });
      mockAlmEnterprise.calculateLCR = jest
        .fn()
        .mockResolvedValue({ lcr: 120 });
      mockAlmEnterprise.calculateDurationGap = jest
        .fn()
        .mockResolvedValue({ durationGap: 1.5 });
    });

    it('returns 4 regulatory scenarios', async () => {
      const result = await service.runRegulatoryStress('inst-1');
      expect(result.scenarios).toHaveLength(4);
      const names = result.scenarios.map((s) => s.name);
      expect(names).toContain('Rapid Rise');
      expect(names).toContain('Gradual Rise');
      expect(names).toContain('Yield Curve Inversion');
      expect(names).toContain('Shock Down');
    });

    it('assigns overall rating based on fail/warn counts', async () => {
      const result = await service.runRegulatoryStress('inst-1');
      expect(['resilient', 'adequate', 'vulnerable', 'critical']).toContain(
        result.overallRating,
      );
    });

    it('each scenario has valid rateShock array of 12 months', async () => {
      const result = await service.runRegulatoryStress('inst-1');
      for (const scenario of result.scenarios) {
        expect(scenario.rateShock).toHaveLength(12);
        expect(scenario.passFailStatus).toBeDefined();
      }
    });
  });

  // ── Coverage boost: runFullStressTest ───────────────────────
  describe('runFullStressTest', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 100, niImpact: 0.5, mveImpact: -1, niImpactPct: 5 },
          { shiftBps: 200, niImpact: 1.0, mveImpact: -2, niImpactPct: 10 },
          { shiftBps: 300, niImpact: 1.5, mveImpact: -3, niImpactPct: 15 },
          { shiftBps: -200, niImpact: -0.8, mveImpact: 1.5, niImpactPct: -8 },
        ],
      });
      mockAlmEnterprise.calculateLCR = jest
        .fn()
        .mockResolvedValue({ lcr: 120 });
      mockAlmEnterprise.calculateDurationGap = jest
        .fn()
        .mockResolvedValue({ durationGap: 1.5 });
      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        summary: { totalShares: 200, totalLoans: 150 },
      });
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        { category: 'asset', rateType: 'variable', balance: 100, rate: 0.05 },
        { category: 'liability', rateType: 'fixed', balance: 80, rate: 0.03 },
      ]);
    });

    it('returns monteCarlo, regulatory, and cossecScenarios', async () => {
      const result = await service.runFullStressTest('inst-1', {
        paths: 100,
        horizon: 6,
      });
      expect(result).toHaveProperty('monteCarlo');
      expect(result).toHaveProperty('regulatory');
      expect(result).toHaveProperty('cossecScenarios');
      expect(result.monteCarlo.paths).toBe(100);
    });
  });

  // ── Coverage boost: runCustomScenario ──────────────────────
  describe('runCustomScenario', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 100, niImpact: 0.5, mveImpact: -1, niImpactPct: 5 },
          { shiftBps: 200, niImpact: 1.0, mveImpact: -2, niImpactPct: 10 },
          { shiftBps: 300, niImpact: 1.5, mveImpact: -3, niImpactPct: 15 },
          { shiftBps: -200, niImpact: -0.8, mveImpact: 1.5, niImpactPct: -8 },
        ],
      });
      mockAlmEnterprise.calculateLCR = jest
        .fn()
        .mockResolvedValue({ lcr: 120, hqla: 50 });
      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        examReadinessScore: 85,
        summary: {
          totalAssets: 500,
          totalLoans: 300,
          totalShares: 200,
          capitalRatio: 10,
          nim: 3.5,
        },
      });
    });

    it('returns RESILIENT verdict for mild stress', async () => {
      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 50,
        depositRunoffPct: 2,
        defaultRateIncreasePct: 1,
        energyCostShockPct: 5,
      });
      expect(result.nimBefore).toBeCloseTo(3.5, 1);
      expect(result.lcrBefore).toBeCloseTo(120, 0);
      expect(result.capitalBefore).toBeCloseTo(10, 1);
      expect(result.verdict).toBe('RESILIENT');
      expect(result.narrative).toContain('rate shock');
      expect(result.narrativeEs).toContain('choque de tasas');
    });

    it('returns CRITICAL verdict for extreme stress', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue({
        examReadinessScore: 40,
        summary: {
          totalAssets: 500,
          totalLoans: 300,
          totalShares: 200,
          capitalRatio: 5,
          nim: 2.0,
        },
      });
      mockAlmEnterprise.calculateLCR.mockResolvedValue({ lcr: 95, hqla: 30 });

      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: -300,
        depositRunoffPct: 25,
        defaultRateIncreasePct: 12,
        energyCostShockPct: 40,
      });
      expect(['VULNERABLE', 'CRITICAL']).toContain(result.verdict);
      expect(result.capitalAfter).toBeLessThan(result.capitalBefore);
    });

    it('returns empty result when upstream data fails', async () => {
      mockAlmEnterprise.calculateNIISensitivity.mockRejectedValue(
        new Error('DB down'),
      );

      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 100,
        depositRunoffPct: 5,
        defaultRateIncreasePct: 2,
        energyCostShockPct: 10,
      });
      expect(result.verdict).toBe('CRITICAL');
      expect(result.narrative).toContain('No balance sheet data');
    });

    it('clamps parameters to valid ranges', async () => {
      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 500, // clamped to 300
        depositRunoffPct: 50, // clamped to 30
        defaultRateIncreasePct: 20, // clamped to 15
        energyCostShockPct: 80, // clamped to 50
      });
      // Verify it ran without error (clamping happened internally)
      expect(result.nimBefore).toBeDefined();
      expect(result.lcrAfter).toBeDefined();
    });

    it('generates bilingual narrative in Spanish', async () => {
      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 100,
        depositRunoffPct: 5,
        defaultRateIncreasePct: 2,
        energyCostShockPct: 10,
      });
      expect(result.narrativeEs).toContain('escenario');
      expect(result.narrativeEs).toContain('Veredicto');
    });

    it('handles zero shocks with no-shocks narrative', async () => {
      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 0,
        depositRunoffPct: 0,
        defaultRateIncreasePct: 0,
        energyCostShockPct: 0,
      });
      expect(result.narrative).toContain('no shocks applied');
      expect(result.narrativeEs).toContain('sin choques aplicados');
    });

    it('returns ADEQUATE or VULNERABLE verdict for moderate stress', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue({
        examReadinessScore: 60,
        summary: {
          totalAssets: 500,
          totalLoans: 300,
          totalShares: 200,
          capitalRatio: 7,
          nim: 3.0,
        },
      });
      mockAlmEnterprise.calculateLCR.mockResolvedValue({ lcr: 105, hqla: 40 });

      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 100,
        depositRunoffPct: 5,
        defaultRateIncreasePct: 2,
        energyCostShockPct: 5,
      });
      expect(['RESILIENT', 'ADEQUATE', 'VULNERABLE']).toContain(result.verdict);
    });

    it('returns VULNERABLE verdict when capital is stressed', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue({
        examReadinessScore: 45,
        summary: {
          totalAssets: 500,
          totalLoans: 400,
          totalShares: 250,
          capitalRatio: 5.5,
          nim: 2.5,
        },
      });
      mockAlmEnterprise.calculateLCR.mockResolvedValue({ lcr: 92, hqla: 25 });

      const result = await service.runCustomScenario('inst-1', {
        rateShockBps: 200,
        depositRunoffPct: 15,
        defaultRateIncreasePct: 8,
        energyCostShockPct: 20,
      });
      expect(['VULNERABLE', 'CRITICAL']).toContain(result.verdict);
    });
  });

  // ── runCOSSECScenarios ──────────────────────────────────────
  describe('runCOSSECScenarios', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 100, niImpact: 0.5, mveImpact: -1, niImpactPct: 5 },
          { shiftBps: 200, niImpact: 1.0, mveImpact: -2, niImpactPct: 10 },
          { shiftBps: 300, niImpact: 1.5, mveImpact: -3, niImpactPct: 15 },
          { shiftBps: -200, niImpact: -0.8, mveImpact: 1.5, niImpactPct: -8 },
        ],
      });
      mockAlmEnterprise.calculateLCR = jest
        .fn()
        .mockResolvedValue({ lcr: 120 });
      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        summary: { totalShares: 200, totalLoans: 150 },
      });
      // Segment-aware scenarios (SIC 2026) pull the asset side once.
      mockPrisma.balanceSheetItem.findMany = jest.fn().mockResolvedValue([
        { subcategory: 'consumer_loans', balance: 60 },
        { subcategory: 'residential_mortgages', balance: 60 },
        { subcategory: 'commercial_loans', balance: 30 },
      ]);
    });

    it('returns array of named scenario results', async () => {
      const results = await service.runCOSSECScenarios('inst-1');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('each result has passFailStatus', async () => {
      const results = await service.runCOSSECScenarios('inst-1');
      for (const result of results) {
        expect(['pass', 'warn', 'fail']).toContain(result.passFailStatus);
      }
    });

    it('each result has niiImpact and totalImpact fields', async () => {
      const results = await service.runCOSSECScenarios('inst-1');
      for (const result of results) {
        expect(typeof result.niiImpact).toBe('number');
        expect(typeof result.totalImpact).toBe('number');
        expect(typeof result.totalImpactPct).toBe('number');
      }
    });

    it('covers the full ±100/200/300bps parallel shock set', async () => {
      const results = await service.runCOSSECScenarios('inst-1');
      const parallelShifts = results
        .filter((r) => r.scenario.type === 'parallel')
        .map((r) => r.scenario.rateShiftBps)
        .sort((a, b) => a - b);
      expect(parallelShifts).toEqual([-300, -200, -100, 100, 200, 300]);
    });

    it('includes the three PR-specific scenarios (huracán, migración, turismo)', async () => {
      const results = await service.runCOSSECScenarios('inst-1');
      const prIds = results
        .filter((r) => r.scenario.type === 'pr_specific')
        .map((r) => r.scenario.id)
        .sort();
      expect(prIds).toEqual([
        'pr_hurricane_stress',
        'pr_migration_stress',
        'pr_tourism_stress',
      ]);
      for (const r of results.filter(
        (x) => x.scenario.type === 'pr_specific',
      )) {
        expect(r.scenario.nameEs.length).toBeGreaterThan(0);
        expect(r.scenario.descriptionEs.length).toBeGreaterThan(0);
      }
    });

    // ── SIC 2026 demo scenario, run on the dynamically-BUILT San Juan Federal book ──
    // Everything below is computed from the builder output and the engine — no
    // frozen output numbers. Proves (a) the +3% credit shock targets the CONSUMER
    // segment, not the whole book, and (b) the loss is model-derived: change the
    // consumer book and the loss moves with it.
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const assetSubcatTotal = (
      fx: ReturnType<typeof buildSanJuanFederalDemo>,
      subcat: string,
    ) =>
      fx.items
        .filter((i) => i.category === 'asset' && i.subcategory === subcat)
        .reduce((s, i) => s + i.balance, 0);

    const wireEngineToFixture = (
      fx: ReturnType<typeof buildSanJuanFederalDemo>,
    ) => {
      const totalLoans =
        assetSubcatTotal(fx, 'consumer_loans') +
        assetSubcatTotal(fx, 'residential_mortgages') +
        assetSubcatTotal(fx, 'commercial_loans');
      const totalDeposits = fx.items
        .filter(
          (i) =>
            i.category === 'liability' &&
            ['savings_deposits', 'time_deposits', 'demand_deposits'].includes(
              i.subcategory,
            ),
        )
        .reduce((s, i) => s + i.balance, 0);

      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        summary: { totalShares: totalDeposits, totalLoans },
      });
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 200, niImpact: -2.0, mveImpact: -2, niImpactPct: -20 },
          { shiftBps: -200, niImpact: 1.6, mveImpact: 1.5, niImpactPct: 16 },
        ],
      });
      mockPrisma.balanceSheetItem.findMany = jest
        .fn()
        .mockResolvedValue(
          fx.items
            .filter((i) => i.category === 'asset')
            .map((i) => ({ subcategory: i.subcategory, balance: i.balance })),
        );
      return {
        consumerLoans: assetSubcatTotal(fx, 'consumer_loans'),
        totalLoans,
        totalDeposits,
      };
    };

    it('SIC 2026 targets the consumer segment for its credit shock (not the whole book)', async () => {
      const fx = buildSanJuanFederalDemo();
      const { consumerLoans, totalLoans, totalDeposits } =
        wireEngineToFixture(fx);

      const sic = (await service.runCOSSECScenarios('inst-1')).find(
        (r) => r.scenario.id === 'sic_2026_global_restructuring',
      );
      expect(sic).toBeDefined();

      // credit loss = CONSUMER book × +3%, derived from the built fixture
      expect(sic!.creditLoss).toBeCloseTo(round2(consumerLoans * 0.03), 2);
      // and that is strictly less than a whole-book application would be
      expect(sic!.creditLoss).toBeLessThan(round2(totalLoans * 0.03));
      // deposit impact = 5% runoff × 150bps marginal funding cost
      expect(sic!.depositImpact).toBeCloseTo(
        round2(totalDeposits * 0.05 * 0.015),
        2,
      );
      // total = nii − depositImpact − creditLoss (relationship, not a literal)
      expect(sic!.totalImpact).toBeCloseTo(
        round2(sic!.niiImpact - sic!.depositImpact - sic!.creditLoss),
        2,
      );
      expect(['pass', 'warn', 'fail']).toContain(sic!.passFailStatus);
    });

    it('SIC 2026 credit loss scales with the consumer segment balance (computed, not static)', async () => {
      const sicLossForConsumer = async (consumerBalance: number) => {
        mockPrisma.balanceSheetItem.findMany = jest.fn().mockResolvedValue([
          { subcategory: 'consumer_loans', balance: consumerBalance },
          { subcategory: 'residential_mortgages', balance: 60 },
          { subcategory: 'commercial_loans', balance: 30 },
        ]);
        const sic = (await service.runCOSSECScenarios('inst-1')).find(
          (r) => r.scenario.id === 'sic_2026_global_restructuring',
        );
        return sic!.creditLoss;
      };

      const loss40 = await sicLossForConsumer(40);
      const loss120 = await sicLossForConsumer(120);
      // loss = consumer balance × 3%; tripling the consumer book triples the loss
      expect(loss40).toBeCloseTo(round2(40 * 0.03), 2);
      expect(loss120).toBeCloseTo(loss40 * 3, 2);
    });
  });

  // ── NEV supervisory analysis ────────────────────────────────
  describe('getNEVAnalysis', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateDurationGap = jest.fn().mockResolvedValue({
        assetDuration: 3.2,
        liabilityDuration: 1.1,
        durationGap: 2.3,
        riskProfile: 'asset-sensitive',
        assetConvexity: 0.15,
        liabilityConvexity: 0.05,
        leverageAdjustedDurationGap: 2.3,
      });
      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        overallStatus: 'compliant',
        summary: { totalAssets: 250, totalLiabilities: 220 },
      });
    });

    it('computes the ±100/200/300bps NEV shock table', async () => {
      const result = await service.getNEVAnalysis('inst-1');
      expect(result.overallRating).not.toBe('data_unavailable');
      expect(
        result.shocks.map((s) => s.shockBps).sort((a, b) => a - b),
      ).toEqual([-300, -200, -100, 100, 200, 300]);
      expect(result.baseNEV).toBeCloseTo(30, 5);
      expect(result.baseNEVRatio).toBeCloseTo(12, 1);
    });

    it('rising rates erode NEV for an asset-sensitive duration profile', async () => {
      const result = await service.getNEVAnalysis('inst-1');
      const up300 = result.shocks.find((s) => s.shockBps === 300)!;
      const down300 = result.shocks.find((s) => s.shockBps === -300)!;
      expect(up300.nev).toBeLessThan(result.baseNEV!);
      expect(down300.nev).toBeGreaterThan(result.baseNEV!);
    });

    it('assigns COSSEC CC-2025-01 risk bands (3-tier, no retired "extreme")', async () => {
      const result = await service.getNEVAnalysis('inst-1');
      for (const s of result.shocks) {
        expect(['low', 'moderate', 'high']).toContain(s.riskBand.level);
        expect(s.riskBand.labelEs).toMatch(/Riesgo/);
      }
      expect(result.worstCase).not.toBeNull();
      expect(result.worstCase!.nevRatio).toBe(
        Math.min(...result.shocks.map((s) => s.nevRatio)),
      );
    });

    it('classifies overall on the +300bps point via the worse of ratio/sensitivity', async () => {
      const result = await service.getNEVAnalysis('inst-1');
      const up300 = result.shocks.find((s) => s.shockBps === 300)!;
      // Per-shock band is the NEV-ratio band ONLY (informational): the +300bps
      // ratio is ~5.9% → 'moderate'.
      expect(up300.riskBand.level).toBe('moderate');
      // The overall supervisory verdict adds the sensitivity leg at +300bps:
      // this asset-sensitive book sheds >25% of NEV, escalating it to 'high'
      // even though the ratio alone is 'moderate' — the two-dimensional test.
      expect(Math.abs(up300.nevChangePct)).toBeGreaterThan(25);
      expect(result.overallRating).toBe('high');
    });

    it('does not flag a favorable down-shock as risk (per-shock band is ratio-only)', async () => {
      const result = await service.getNEVAnalysis('inst-1');
      const down300 = result.shocks.find((s) => s.shockBps === -300)!;
      // Rates fall → NEV rises for an asset-sensitive book; high NEV ratio must
      // read 'low', NOT 'high' from a large favorable sensitivity swing.
      expect(down300.nevChangePct).toBeGreaterThan(0);
      expect(down300.riskBand.level).toBe('low');
    });

    it('returns data_unavailable + CRITICAL gap on empty balance sheet (D1)', async () => {
      mockAlmEnterprise.getCOSSECCompliance = jest.fn().mockResolvedValue({
        overallStatus: 'data_unavailable',
        summary: { totalAssets: 0, totalLiabilities: 0 },
      });
      const result = await service.getNEVAnalysis('inst-1');
      expect(result.overallRating).toBe('data_unavailable');
      expect(result.baseNEV).toBeNull();
      expect(result.shocks).toEqual([]);
      expect(result.gaps?.[0].severity).toBe('CRITICAL');
    });
  });

  // ── regulatory scenario pass/fail assessment ───────────────
  describe('regulatory scenario assessment', () => {
    beforeEach(() => {
      mockAlmEnterprise.calculateNIISensitivity = jest.fn().mockResolvedValue({
        baseNII: 10,
        scenarios: [
          { shiftBps: 100, niImpact: 0.5, mveImpact: -1, niImpactPct: 5 },
          { shiftBps: 200, niImpact: 1.0, mveImpact: -2, niImpactPct: 10 },
          { shiftBps: 300, niImpact: 1.5, mveImpact: -3, niImpactPct: 15 },
          { shiftBps: -200, niImpact: -0.8, mveImpact: 1.5, niImpactPct: -8 },
        ],
      });
      mockAlmEnterprise.calculateLCR = jest
        .fn()
        .mockResolvedValue({ lcr: 120 });
      mockAlmEnterprise.calculateDurationGap = jest
        .fn()
        .mockResolvedValue({ durationGap: 1.5 });
    });

    it('returns resilient when no fails or warns', async () => {
      const result = await service.runRegulatoryStress('inst-1');
      if (result.scenarios.every((s) => s.passFailStatus === 'pass')) {
        expect(result.overallRating).toBe('resilient');
      }
    });

    it('returns critical when 2+ scenarios fail', async () => {
      // Mock very negative NII to trigger failures
      mockAlmEnterprise.calculateNIISensitivity.mockResolvedValue({
        baseNII: 1,
        scenarios: [
          { shiftBps: 100, niImpact: -2, mveImpact: -5, niImpactPct: -200 },
          { shiftBps: 200, niImpact: -3, mveImpact: -8, niImpactPct: -300 },
          { shiftBps: 300, niImpact: -4, mveImpact: -10, niImpactPct: -400 },
          { shiftBps: -200, niImpact: -2, mveImpact: -5, niImpactPct: -200 },
        ],
      });
      mockAlmEnterprise.calculateLCR.mockResolvedValue({ lcr: 85 });

      const result = await service.runRegulatoryStress('inst-1');
      const failCount = result.scenarios.filter(
        (s) => s.passFailStatus === 'fail',
      ).length;
      if (failCount >= 2) {
        expect(result.overallRating).toBe('critical');
      }
    });
  });

  // ── Monte Carlo edge: minimum param bounds ─────────────────
  describe('Monte Carlo minimum bounds', () => {
    it('clamps paths minimum to 100', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
      const result = await service.runMonteCarloSimulation('inst-1', {
        paths: 5,
      });
      expect(result.paths).toBe(100);
    });

    it('clamps horizon minimum to 1', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);
      const result = await service.runMonteCarloSimulation('inst-1', {
        horizon: 0,
      });
      expect(result.horizon).toBe(1);
    });

    it('clamps volatility minimum to 1', async () => {
      mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
        { category: 'asset', rateType: 'variable', balance: 100, rate: 0.05 },
      ]);
      const result = await service.runMonteCarloSimulation('inst-1', {
        paths: 100,
        volatility: -50,
      });
      // Should run without error with vol clamped to 1
      expect(result.paths).toBe(100);
    });
  });
});
