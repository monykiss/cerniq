import {
  CapitalPlanningService,
  type CapitalGlidePathAssumptions,
} from './capital-planning.service';

describe('CapitalPlanningService — indivisible-capital glide path (W1.4)', () => {
  let svc: CapitalPlanningService;

  beforeEach(() => {
    svc = new CapitalPlanningService();
  });

  // A "building toward the floor" coop: 3.0% net equity, no growth, annual
  // periods, 0.6%/yr ROA fully retained → equity climbs 0.6pp of assets/yr:
  //   yr0 3.0%, yr1 3.6%, yr2 4.2% ≥ 4% floor → crosses at year 2.
  const BUILDING: CapitalGlidePathAssumptions = {
    annualAssetGrowthPct: 0,
    annualRoaPct: 0.6,
    surplusRetentionPct: 100,
    horizonYears: 5,
    periodsPerYear: 1,
  };
  const startBuilding = {
    equity: 3.0,
    totalAssets: 100,
    riskWeightedAssets: 50,
  };

  it('returns a computed glide path with the expected shape', () => {
    const r = svc.projectGlidePath(startBuilding, BUILDING);
    expect(r.overallStatus).toBe('computed');
    expect(r.periods).toHaveLength(6); // years 0..5 inclusive
    expect(r.startingNetEquityRatioPct).toBeCloseTo(3.0, 6);
  });

  it('crosses the 4% Net-Equity floor at exactly year 2 (computed, not asserted)', () => {
    const r = svc.projectGlidePath(startBuilding, BUILDING);
    expect(r.milestones.alreadyMeetsNetEquityFloor).toBe(false);
    expect(r.milestones.yearsToNetEquityFloor).toBe(2);
    expect(r.periods[1].netEquityRatioPct).toBeCloseTo(3.6, 6);
    expect(r.periods[2].netEquityRatioPct).toBeCloseTo(4.2, 6);
  });

  it('projects the statutory (equity/RWA) ratio and its 8% crossing', () => {
    const r = svc.projectGlidePath(startBuilding, BUILDING);
    // 3.0/50=6%, 3.6/50=7.2%, 4.2/50=8.4% → crosses 8% at year 2.
    expect(r.startingStatutoryRatioPct).toBeCloseTo(6, 6);
    expect(r.milestones.yearsToStatutoryFloor).toBe(2);
  });

  it('accumulates equity monotonically while assets stay flat (no-growth case)', () => {
    const r = svc.projectGlidePath(startBuilding, BUILDING);
    for (let i = 1; i < r.periods.length; i++) {
      expect(r.periods[i].equity).toBeGreaterThan(r.periods[i - 1].equity);
      expect(r.periods[i].totalAssets).toBeCloseTo(100, 6);
    }
  });

  it('an already-compliant coop reports alreadyMeets + 0 years to floor', () => {
    const r = svc.projectGlidePath(
      { equity: 10, totalAssets: 100, riskWeightedAssets: 50 },
      BUILDING,
    );
    expect(r.milestones.alreadyMeetsNetEquityFloor).toBe(true);
    expect(r.milestones.yearsToNetEquityFloor).toBe(0);
  });

  it('skips the statutory leg + raises a WARNING gap when RWA is absent', () => {
    const r = svc.projectGlidePath({ equity: 3.0, totalAssets: 100 }, BUILDING);
    expect(r.startingStatutoryRatioPct).toBeNull();
    expect(r.periods[0].statutoryRatioPct).toBeNull();
    expect(r.milestones.yearsToStatutoryFloor).toBeNull();
    expect(
      r.gaps.some(
        (g) =>
          g.field === 'capital.glidePath.riskWeightedAssets' &&
          g.severity === 'WARNING',
      ),
    ).toBe(true);
  });

  describe('stressed path', () => {
    it('a one-time capital hit delays the floor crossing (recovers slower)', () => {
      const r = svc.projectGlidePath(startBuilding, {
        ...BUILDING,
        stressCapitalHitPct: 20, // 3.0 → 2.4 at t0
      });
      expect(r.stressed).not.toBeNull();
      // stressed: 2.4, 3.0, 3.6, 4.2 → crosses at year 3, one year later.
      expect(r.stressed!.yearsToRecoverNetEquityFloor).toBe(3);
      expect(r.stressed!.yearsToRecoverNetEquityFloor!).toBeGreaterThan(
        r.milestones.yearsToNetEquityFloor!,
      );
      // every stressed period sits below its baseline counterpart.
      r.stressed!.periods.forEach((p, i) => {
        expect(p.netEquityRatioPct).toBeLessThan(
          r.periods[i].netEquityRatioPct,
        );
      });
    });

    it('omits the stressed path when no capital hit is configured', () => {
      const r = svc.projectGlidePath(startBuilding, BUILDING);
      expect(r.stressed).toBeNull();
    });
  });

  it('reaches the floor SOONER with higher surplus retention (responds to inputs)', () => {
    const slow = svc.projectGlidePath(startBuilding, {
      ...BUILDING,
      surplusRetentionPct: 50,
    });
    const fast = svc.projectGlidePath(startBuilding, {
      ...BUILDING,
      surplusRetentionPct: 100,
    });
    expect(fast.milestones.yearsToNetEquityFloor!).toBeLessThanOrEqual(
      slow.milestones.yearsToNetEquityFloor ?? Infinity,
    );
  });

  it('ALWAYS attaches the planning-assumptions disclosure gap (D1)', () => {
    const r = svc.projectGlidePath(startBuilding, BUILDING);
    const gap = r.gaps.find((g) => g.field === 'capital.glidePath.assumptions');
    expect(gap).toBeDefined();
    expect(gap!.severity).toBe('WARNING');
    expect(gap!.context).toMatchObject({ surplusRetentionPct: 100 });
    expect(gap!.action).toMatch(/estimad/); // Spanish-first "estimados"
  });

  it('is deterministic — identical inputs produce identical output', () => {
    const a = svc.projectGlidePath(startBuilding, BUILDING);
    const b = svc.projectGlidePath(startBuilding, BUILDING);
    expect(a).toEqual(b);
  });

  it('clamps absurd assumptions into sane bounds', () => {
    const r = svc.projectGlidePath(startBuilding, {
      annualAssetGrowthPct: 999,
      annualRoaPct: -999,
      surplusRetentionPct: 250,
      horizonYears: 200,
    });
    expect(r.assumptions.annualAssetGrowthPct).toBe(50);
    expect(r.assumptions.annualRoaPct).toBe(-20);
    expect(r.assumptions.surplusRetentionPct).toBe(100);
    expect(r.assumptions.horizonYears).toBe(30);
  });

  it('defaults surplus retention to the conservative Ley 255 §6.02 floor (25%)', () => {
    // No surplusRetentionPct supplied → must fall back to the 25% statutory-floor
    // allocation, NOT the optimistic full-retention figure. Founder decision: a
    // planning default must never overstate a coop's climb to the capital floor.
    const r = svc.projectGlidePath({
      equity: 3,
      totalAssets: 100,
      riskWeightedAssets: 50,
    });
    expect(r.assumptions.surplusRetentionPct).toBe(25);
    const gap = r.gaps.find((g) => g.field === 'capital.glidePath.assumptions');
    expect(gap?.context).toMatchObject({ surplusRetentionPct: 25 });
  });

  describe('D1 — refuses to project on a missing balance sheet', () => {
    it('zero assets → data_unavailable + CRITICAL gap, no phantom path', () => {
      const r = svc.projectGlidePath({ equity: 5, totalAssets: 0 }, BUILDING);
      expect(r.overallStatus).toBe('data_unavailable');
      expect(r.periods).toEqual([]);
      expect(r.gaps[0]).toMatchObject({
        field: 'capital.glidePath',
        severity: 'CRITICAL',
      });
    });
  });

  describe('planFromCossecSummary', () => {
    it('maps a COSSEC summary into the projector input', () => {
      const r = svc.planFromCossecSummary(
        { equity: 3.0, totalAssets: 100, riskWeightedAssets: 50 },
        BUILDING,
      );
      expect(r.overallStatus).toBe('computed');
      expect(r.startingNetEquityRatioPct).toBeCloseTo(3.0, 6);
    });

    it('propagates the data_unavailable shell when the summary is empty', () => {
      const r = svc.planFromCossecSummary(
        { equity: 0, totalAssets: 0 },
        BUILDING,
      );
      expect(r.overallStatus).toBe('data_unavailable');
    });
  });
});
