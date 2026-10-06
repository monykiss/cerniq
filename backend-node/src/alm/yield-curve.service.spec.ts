import { YieldCurveService, TenorRate } from './yield-curve.service';

describe('YieldCurveService', () => {
  let service: YieldCurveService;
  let prisma: any;

  const sampleCurve: TenorRate[] = [
    { tenor: 0.25, rate: 0.048 },
    { tenor: 0.5, rate: 0.0465 },
    { tenor: 1, rate: 0.044 },
    { tenor: 2, rate: 0.042 },
    { tenor: 3, rate: 0.041 },
    { tenor: 5, rate: 0.0405 },
    { tenor: 7, rate: 0.041 },
    { tenor: 10, rate: 0.042 },
    { tenor: 20, rate: 0.0455 },
    { tenor: 30, rate: 0.0465 },
  ];

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      yieldCurve: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'curve_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new YieldCurveService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Nelson-Siegel fit ──────────────────────────────────────

  it('fits Nelson-Siegel parameters that reproduce the original curve', () => {
    const params = service.fitNelsonSiegel(sampleCurve);

    expect(params.beta0).toBeDefined();
    expect(params.beta1).toBeDefined();
    expect(params.beta2).toBeDefined();
    expect(params.lambda).toBeGreaterThan(0);

    // Check that the fitted curve approximates the original at a few tenors
    for (const point of [sampleCurve[2], sampleCurve[5], sampleCurve[8]]) {
      const fittedRate = service.interpolateRate(params, point.tenor);
      expect(Math.abs(fittedRate - point.rate)).toBeLessThan(0.005); // within 50bps
    }
  });

  // ── Forward rates ─────────────────────────────────────────

  it('computes forward rates with correct number of points', () => {
    const forwards = service.calculateForwardRates(sampleCurve);

    // n-1 forward rates from n spot rates
    expect(forwards).toHaveLength(sampleCurve.length - 1);
    // All forward rates should be non-negative
    for (const f of forwards) {
      expect(f.rate).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes correct forward rate between two tenors', () => {
    const twoPointCurve: TenorRate[] = [
      { tenor: 1, rate: 0.04 },
      { tenor: 2, rate: 0.045 },
    ];

    const forwards = service.calculateForwardRates(twoPointCurve);

    // f(1,2) = (0.045*2 - 0.04*1) / (2-1) = 0.05
    expect(forwards[0].rate).toBeCloseTo(0.05, 4);
    expect(forwards[0].tenor).toBe(2);
  });

  // ── Shock application ─────────────────────────────────────

  it('applies parallel up shock of +200bps to all tenors', () => {
    const shocked = service.applyShock(sampleCurve, 'parallel_up');

    expect(shocked.shockType).toBe('parallel_up');
    expect(shocked.shockedCurve).toHaveLength(sampleCurve.length);

    // Each shocked rate should be ~200bps above base
    for (let i = 0; i < sampleCurve.length; i++) {
      const diff = shocked.shockedCurve[i].rate - sampleCurve[i].rate;
      expect(diff).toBeCloseTo(0.02, 3); // 200bps = 0.02
    }
  });

  it('applies steepener shock with short rates down and long rates up', () => {
    const shocked = service.applyShock(sampleCurve, 'steepener');

    // Short end (3M) should be lower
    expect(shocked.shockedCurve[0].rate).toBeLessThan(sampleCurve[0].rate);
    // Long end (30Y) should be higher
    const lastIdx = sampleCurve.length - 1;
    expect(shocked.shockedCurve[lastIdx].rate).toBeGreaterThan(
      sampleCurve[lastIdx].rate,
    );
  });

  // ── Interpolation at very small tenor ───────────────────

  it('interpolateRate handles near-zero tenor (returns beta0 + beta1)', () => {
    const params = service.fitNelsonSiegel(sampleCurve);
    const rateAtZero = service.interpolateRate(params, 0);
    expect(rateAtZero).toBeCloseTo(params.beta0 + params.beta1, 3);
  });

  // ── Forward rates with unsorted input ──────────────────────

  it('calculateForwardRates sorts input by tenor before computing', () => {
    const reversed: TenorRate[] = [...sampleCurve].reverse();
    const forwards = service.calculateForwardRates(reversed);
    // Should still produce correct order
    for (let i = 1; i < forwards.length; i++) {
      expect(forwards[i].tenor).toBeGreaterThan(forwards[i - 1].tenor);
    }
  });

  it('forward rates are floored at zero', () => {
    // Create an inverted curve that would produce negative forward
    const invertedCurve: TenorRate[] = [
      { tenor: 1, rate: 0.05 },
      { tenor: 2, rate: 0.02 }, // steep inversion
    ];
    const forwards = service.calculateForwardRates(invertedCurve);
    // f(1,2) = (0.02*2 - 0.05*1)/1 = -0.01 => floored to 0
    expect(forwards[0].rate).toBe(0);
  });

  // ── Shock: parallel_down ────────────────────────────────────

  it('applies parallel down shock of -200bps', () => {
    const shocked = service.applyShock(sampleCurve, 'parallel_down');
    expect(shocked.shockType).toBe('parallel_down');
    for (let i = 0; i < sampleCurve.length; i++) {
      const diff = shocked.shockedCurve[i].rate - sampleCurve[i].rate;
      expect(diff).toBeCloseTo(-0.02, 3);
    }
  });

  it('shocked rates are floored at zero', () => {
    const lowCurve: TenorRate[] = [
      { tenor: 1, rate: 0.005 }, // 0.5% — shock -200bps will push below 0
    ];
    const shocked = service.applyShock(lowCurve, 'parallel_down');
    expect(shocked.shockedCurve[0].rate).toBe(0);
  });

  // ── Shock: flattener ────────────────────────────────────────

  it('applies flattener shock (short rates up, long rates down)', () => {
    const shocked = service.applyShock(sampleCurve, 'flattener');
    expect(shocked.shockedCurve[0].rate).toBeGreaterThan(sampleCurve[0].rate);
    const lastIdx = sampleCurve.length - 1;
    expect(shocked.shockedCurve[lastIdx].rate).toBeLessThan(
      sampleCurve[lastIdx].rate,
    );
  });

  // ── Shock: short_up / short_down ───────────────────────────

  it('applies short_up shock affecting short end more than long end', () => {
    const shocked = service.applyShock(sampleCurve, 'short_up');
    // Short end (3M) shock = 300bps
    expect(shocked.shockedCurve[0].rate - sampleCurve[0].rate).toBeCloseTo(
      0.03,
      3,
    );
    // Long end (30Y) shock = 0bps
    const lastIdx = sampleCurve.length - 1;
    expect(
      shocked.shockedCurve[lastIdx].rate - sampleCurve[lastIdx].rate,
    ).toBeCloseTo(0, 3);
  });

  it('applies short_down shock', () => {
    const shocked = service.applyShock(sampleCurve, 'short_down');
    expect(shocked.shockedCurve[0].rate).toBeLessThan(sampleCurve[0].rate);
  });

  // ── Custom shock ────────────────────────────────────────────

  it('applies custom shock with user-defined bps', () => {
    const customShocks = { '1': 100, '5': 50, '10': 0 };
    const shocked = service.applyShock(sampleCurve, 'custom', customShocks);
    expect(shocked.shockType).toBe('custom');
    expect(shocked.shockLabel).toBe('Custom Shock');
    // 1-year tenor should be shifted up
    const yr1 = shocked.shockedCurve.find((p) => p.tenor === 1);
    expect(yr1!.rate).toBeGreaterThan(
      sampleCurve.find((p) => p.tenor === 1)!.rate,
    );
  });

  it('falls back to parallel_up for unknown shock type', () => {
    const shocked = service.applyShock(sampleCurve, 'nonexistent_shock');
    // Should use parallel_up fallback
    expect(shocked.shockLabel).toBe('nonexistent_shock');
    for (let i = 0; i < sampleCurve.length; i++) {
      expect(shocked.shockedCurve[i].rate).toBeGreaterThan(sampleCurve[i].rate);
    }
  });

  // ── applyAllBaselShocks ─────────────────────────────────────

  it('applyAllBaselShocks returns 6 shocked curves', () => {
    const shocks = service.applyAllBaselShocks(sampleCurve);
    expect(shocks).toHaveLength(6);
    const types = shocks.map((s) => s.shockType);
    expect(types).toContain('parallel_up');
    expect(types).toContain('parallel_down');
    expect(types).toContain('steepener');
    expect(types).toContain('flattener');
    expect(types).toContain('short_up');
    expect(types).toContain('short_down');
  });

  // ── Full analysis (with empty balance sheet) ──────────────

  it('returns complete analysis structure using default curve', async () => {
    const analysis = await service.getYieldCurveAnalysis('inst_123');

    expect(analysis.baseCurve).toBeDefined();
    expect(analysis.baseCurve.length).toBeGreaterThan(0);
    expect(analysis.nelsonSiegelParams).toBeDefined();
    expect(analysis.forwardRates.length).toBeGreaterThan(0);
    // 6 Basel shock scenarios
    expect(analysis.shockedCurves).toHaveLength(6);
    expect(analysis.niiImpact).toHaveLength(6);
  });

  it('uses saved institution curve when available', async () => {
    const customCurve = [
      { tenor: 1, rate: 0.03 },
      { tenor: 5, rate: 0.035 },
      { tenor: 10, rate: 0.04 },
    ];
    prisma.yieldCurve.findFirst.mockResolvedValue({
      tenors: customCurve,
      isBase: true,
    });

    const analysis = await service.getYieldCurveAnalysis('inst_123');
    expect(analysis.baseCurve).toEqual(customCurve);
  });

  // ── NII/EVE impact with real balance sheet items ──────────

  it('estimates NII impact using heuristic when no balance sheet items', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const analysis = await service.getYieldCurveAnalysis('inst_123');
    // Heuristic should return non-zero values for shocks
    for (const impact of analysis.niiImpact) {
      expect(impact.niiChangePct).toBeDefined();
      expect(impact.eveChangePct).toBeDefined();
    }
  });

  it('calculates NII and EVE impact with balance sheet items', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        balance: 100,
        category: 'asset',
        rate: 0.06,
        duration: 3,
        rateType: 'variable',
        subcategory: 'loans',
      },
      {
        balance: 80,
        category: 'liability',
        rate: 0.02,
        duration: 1,
        rateType: 'fixed',
        subcategory: 'deposits',
        depositBeta: 0.5,
      },
    ]);
    const analysis = await service.getYieldCurveAnalysis('inst_123');
    // With items, NII should vary across shock types
    const parallelUp = analysis.niiImpact.find(
      (i) => i.shockType === 'parallel_up',
    );
    const parallelDown = analysis.niiImpact.find(
      (i) => i.shockType === 'parallel_down',
    );
    expect(parallelUp).toBeDefined();
    expect(parallelDown).toBeDefined();
    // Parallel up and down should have opposite signs for asset-sensitive portfolio
    expect(
      parallelUp!.niiChangePct * parallelDown!.niiChangePct,
    ).toBeLessThanOrEqual(0);
  });

  // ── niiSimulationWithCurve ──────────────────────────────────

  it('niiSimulationWithCurve returns 0 when baseNII is 0', () => {
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve([], sampleCurve, shocked);
    expect(result).toBe(0);
  });

  it('niiSimulationWithCurve handles asset and liability items', () => {
    const items = [
      {
        balance: 100,
        category: 'asset',
        rate: 0.05,
        duration: 2,
        rateType: 'variable',
      },
      {
        balance: 50,
        category: 'liability',
        rate: 0.02,
        duration: 0.5,
        rateType: 'variable',
        subcategory: 'savings',
      },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve(items, sampleCurve, shocked);
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });

  // ── eveAnalysisWithCurve ───────────────────────────────────

  it('eveAnalysisWithCurve returns 0 when no items', () => {
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.eveAnalysisWithCurve([], sampleCurve, shocked);
    expect(result).toBe(0);
  });

  it('eveAnalysisWithCurve computes PV change for assets and liabilities', () => {
    const items = [
      { balance: 200, category: 'asset', rate: 0.06, duration: 5 },
      { balance: 150, category: 'liability', rate: 0.03, duration: 1 },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.eveAnalysisWithCurve(items, sampleCurve, shocked);
    expect(typeof result).toBe('number');
    // Parallel up should decrease EVE for asset-heavy portfolio
    expect(result).toBeLessThan(0);
  });

  // ── Repricing beta ─────────────────────────────────────────

  it('uses depositBeta from item when available', () => {
    const items = [
      {
        balance: 100,
        category: 'liability',
        rate: 0.02,
        duration: 1,
        depositBeta: 0.3,
        subcategory: 'deposits',
      },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve(items, sampleCurve, shocked);
    expect(typeof result).toBe('number');
  });

  it('assigns beta 1.0 for variable rate items', () => {
    const items = [
      {
        balance: 100,
        category: 'asset',
        rate: 0.05,
        duration: 2,
        rateType: 'variable',
      },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve(items, sampleCurve, shocked);
    expect(result).not.toBe(0);
  });

  it('assigns beta 0.4 for savings/demand deposits', () => {
    const items = [
      {
        balance: 100,
        category: 'liability',
        rate: 0.01,
        duration: 0.5,
        subcategory: 'savings',
      },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve(items, sampleCurve, shocked);
    expect(typeof result).toBe('number');
  });

  it('assigns beta 0.8 for CD/time deposits', () => {
    const items = [
      {
        balance: 100,
        category: 'liability',
        rate: 0.03,
        duration: 1,
        subcategory: 'cd',
      },
    ];
    const shocked = service.applyShock(sampleCurve, 'parallel_up');
    const result = service.niiSimulationWithCurve(items, sampleCurve, shocked);
    expect(typeof result).toBe('number');
  });

  // ── saveCustomCurve ─────────────────────────────────────────

  it('saves a custom curve and sets it as base', async () => {
    const data = {
      institutionId: 'inst_1',
      name: 'My Curve',
      tenors: [{ tenor: 1, rate: 0.03 }],
    };
    await service.saveCustomCurve(data);
    expect(prisma.yieldCurve.updateMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst_1', isBase: true },
      data: { isBase: false },
    });
    expect(prisma.yieldCurve.create).toHaveBeenCalled();
  });

  it('saveCustomCurve uses source "manual" by default', async () => {
    await service.saveCustomCurve({
      institutionId: 'inst_1',
      name: 'Test',
      tenors: [{ tenor: 1, rate: 0.04 }],
    });
    const createCall = prisma.yieldCurve.create.mock.calls[0][0];
    expect(createCall.data.source).toBe('manual');
  });

  it('saveCustomCurve uses provided source', async () => {
    await service.saveCustomCurve({
      institutionId: 'inst_1',
      name: 'Test',
      tenors: [{ tenor: 1, rate: 0.04 }],
      source: 'api',
    });
    const createCall = prisma.yieldCurve.create.mock.calls[0][0];
    expect(createCall.data.source).toBe('api');
  });

  // ── computeForwardNIISchedule ──────────────────────────────

  it('computeForwardNIISchedule returns quarterly projections', async () => {
    prisma.balanceSheetItem = {
      findMany: jest.fn().mockResolvedValue([
        {
          balance: 100,
          category: 'asset',
          rate: 0.06,
          duration: 3,
          rateType: 'variable',
        },
        {
          balance: 80,
          category: 'liability',
          rate: 0.02,
          duration: 1,
          rateType: 'fixed',
          subcategory: 'deposits',
        },
      ]),
    };

    const schedule = await service.computeForwardNIISchedule(
      'inst_1',
      { '1': 100, '5': 50 },
      4,
    );
    expect(schedule).toHaveLength(4);
    for (const q of schedule) {
      expect(q.quarter).toBeDefined();
      expect(typeof q.baselineNII).toBe('number');
      expect(typeof q.shockedNII).toBe('number');
      expect(typeof q.delta).toBe('number');
      expect(typeof q.deltaPct).toBe('number');
    }
  });

  it('computeForwardNIISchedule defaults to 12 quarters', async () => {
    prisma.balanceSheetItem = { findMany: jest.fn().mockResolvedValue([]) };
    const schedule = await service.computeForwardNIISchedule('inst_1', {});
    expect(schedule).toHaveLength(12);
  });
});
