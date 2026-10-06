import { LiquidityStressPackService } from './liquidity-stress-pack.service';

describe('LiquidityStressPackService', () => {
  const mk = (items: unknown[], liq: unknown = null) =>
    new LiquidityStressPackService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
      liquidityPosition: { findFirst: jest.fn().mockResolvedValue(liq) },
    } as any);

  it('should be defined', () => {
    expect(mk([])).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the demo scenario outcomes) ──

  it('returns the 5 COSSEC scenarios each marked data_unavailable when no balance sheet', async () => {
    const results = await mk([]).runAllScenarios('inst_1');

    expect(results).toHaveLength(5);
    expect(results[0].scenarioId).toBe('SCEN-1');
    expect(results[4].scenarioId).toBe('SCEN-5');
    for (const r of results) {
      expect(r.status).toBe('data_unavailable');
      expect(r.daysOfLiquidity).toBeNull();
      expect(r.lcr).toBeNull();
      expect(r.hqlaCoverage).toBeNull();
      expect(r.availableLiquid).toBeNull();
      expect(r.netOutflow).toBeNull();
      expect(r.surplus).toBeNull();
      expect(r.regulatoryStatus).toBeNull();
      expect(r.narrative).toBeNull();
      expect(r.narrativeEs).toBeNull();
      // scenario id/name are a fixed regulatory catalog, not fabricated data
      expect(r.scenarioName.length).toBeGreaterThan(0);
      expect(r.scenarioNameEs.length).toBeGreaterThan(0);
      const critical = r.gaps?.find((g) => g.severity === 'CRITICAL');
      expect(critical).toBeDefined();
      expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    }
  });

  it('runScenario returns the requested scenario as a data_unavailable shell when empty', async () => {
    const result = await mk([]).runScenario('inst_1', 'SCEN-2');
    expect(result.scenarioId).toBe('SCEN-2');
    expect(result.scenarioName).toContain('Prolonged');
    expect(result.status).toBe('data_unavailable');
    expect(result.netOutflow).toBeNull();
  });

  // ── D1: real-data stress computation ───────────────────────────

  describe('with real balance sheet items', () => {
    it('computes all 5 scenarios with status ok from real data', async () => {
      const results = await mk(
        [
          { category: 'asset', balance: 1000 },
          { category: 'liability', balance: 900 },
        ],
        { hqlaLevel1: 100, hqlaLevel2: 50 },
      ).runAllScenarios('inst_1');

      expect(results).toHaveLength(5);
      for (const r of results) {
        expect(r.status).toBe('ok');
        expect(r.gaps).toBeUndefined();
        expect(r.netOutflow!).toBeGreaterThanOrEqual(0);
        expect(r.daysOfLiquidity!).toBeGreaterThanOrEqual(0);
        expect(['PASS', 'WATCH', 'FAIL']).toContain(r.regulatoryStatus!);
      }
    });

    it('generates bilingual narratives for each computed scenario', async () => {
      const results = await mk(
        [
          { category: 'asset', balance: 1000 },
          { category: 'liability', balance: 900 },
        ],
        { hqlaLevel1: 100, hqlaLevel2: 50 },
      ).runAllScenarios('inst_1');

      for (const r of results) {
        expect(r.narrative!.length).toBeGreaterThan(10);
        expect(r.narrativeEs!.length).toBeGreaterThan(10);
      }
    });

    it('runScenario returns a single computed scenario', async () => {
      const result = await mk(
        [
          { category: 'asset', balance: 1000 },
          { category: 'liability', balance: 900 },
        ],
        { hqlaLevel1: 100, hqlaLevel2: 50 },
      ).runScenario('inst_1', 'SCEN-2');
      expect(result.scenarioId).toBe('SCEN-2');
      expect(result.status).toBe('ok');
      expect(result.scenarioName).toContain('Prolonged');
    });
  });
});
