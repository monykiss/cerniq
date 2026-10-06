import { ForwardSimulationService } from './forward-simulation.service';

describe('ForwardSimulationService', () => {
  // Clone items so the service's in-place balance mutation (preserved from the
  // original projection loop) cannot leak across tests that share a fixture.
  const mk = (items: unknown[]) =>
    new ForwardSimulationService({
      balanceSheetItem: {
        findMany: jest
          .fn()
          .mockResolvedValue(items.map((x) => ({ ...(x as object) }))),
      },
    } as any);

  const realItems = [
    {
      category: 'asset',
      subcategory: 'consumer_loans',
      name: 'Consumer Portfolio',
      balance: 200,
      rate: 0.06,
      duration: 3,
      rateType: 'variable',
      depositBeta: null,
    },
    {
      category: 'liability',
      subcategory: 'savings',
      name: 'Savings Deposits',
      balance: 150,
      rate: 0.02,
      duration: 1,
      rateType: 'variable',
      depositBeta: 0.4,
    },
  ];

  it('should be defined', () => {
    expect(mk([])).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the $41.2M demo) ────────

  it('returns a data_unavailable shell with null summary + CRITICAL gap when no items', async () => {
    const result = await mk([]).runForwardSimulation({
      institutionId: 'inst_123',
    });

    expect(result.status).toBe('data_unavailable');
    expect(result.quarters).toEqual([]);
    expect(result.summary.baseNIIYear1).toBeNull();
    expect(result.summary.baseNIIYear3).toBeNull();
    expect(result.summary.up200NIIYear3).toBeNull();
    expect(result.summary.down100NIIYear3).toBeNull();
    expect(result.summary.worstCaseNWR).toBeNull();
    expect(result.summary.worstCaseLCR).toBeNull();
    // config is echoed even in the empty shell
    expect(result.config.horizon).toBe(3);
    expect(result.config.ratePaths).toEqual(['base', 'up200', 'down100']);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('forwardSimulation.balanceSheet');
  });

  it('echoes a custom horizon + rate paths in the empty shell config', async () => {
    const result = await mk([]).runForwardSimulation({
      institutionId: 'inst_123',
      horizon: 2,
      ratePaths: ['base'],
    });
    expect(result.status).toBe('data_unavailable');
    expect(result.config.horizon).toBe(2);
    expect(result.config.ratePaths).toEqual(['base']);
    expect(result.quarters).toEqual([]);
  });

  // ── D1: real-data projection ───────────────────────────────────

  describe('with real balance sheet items', () => {
    it('projects 3 paths × 12 quarters and status ok', async () => {
      const result = await mk(realItems).runForwardSimulation({
        institutionId: 'inst_123',
      });
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.quarters).toHaveLength(36); // 3 paths × 12 quarters
    });

    it('produces correct quarter count for a 2-year horizon', async () => {
      const result = await mk(realItems).runForwardSimulation({
        institutionId: 'inst_123',
        horizon: 2,
      });
      expect(result.config.horizon).toBe(2);
      expect(result.quarters).toHaveLength(24); // 3 paths × 8 quarters
    });

    it('limits simulation to specified rate paths only', async () => {
      const result = await mk(realItems).runForwardSimulation({
        institutionId: 'inst_123',
        ratePaths: ['base'],
      });
      expect(result.config.ratePaths).toEqual(['base']);
      expect(result.quarters).toHaveLength(12);
      expect(result.quarters.every((q) => q.ratePath === 'base')).toBe(true);
    });

    it('projects positive NII and balances across the base path', async () => {
      const result = await mk(realItems).runForwardSimulation({
        institutionId: 'inst_123',
        ratePaths: ['base', 'up200'],
      });
      expect(result.quarters).toHaveLength(24);
      const baseQuarters = result.quarters.filter((q) => q.ratePath === 'base');
      expect(baseQuarters).toHaveLength(12);
      for (const q of baseQuarters) {
        expect(q.projectedNII).toBeGreaterThan(0);
        expect(q.totalAssets).toBeGreaterThan(0);
        expect(q.totalLiabilities).toBeGreaterThan(0);
      }
    });

    it('produces different NII under up200 shock versus base', async () => {
      const result = await mk([
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Variable Loans',
          balance: 300,
          rate: 0.07,
          duration: 5,
          rateType: 'variable',
          depositBeta: null,
        },
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          name: 'Demand Deposits',
          balance: 250,
          rate: 0.005,
          duration: 0.5,
          rateType: 'variable',
          depositBeta: 0.1,
        },
      ]).runForwardSimulation({
        institutionId: 'inst_123',
        ratePaths: ['base', 'up200'],
      });

      const baseTotalNII = result.quarters
        .filter((q) => q.ratePath === 'base')
        .reduce((s, q) => s + q.projectedNII, 0);
      const up200TotalNII = result.quarters
        .filter((q) => q.ratePath === 'up200')
        .reduce((s, q) => s + q.projectedNII, 0);

      expect(up200TotalNII).not.toBeCloseTo(baseTotalNII, 0);
      expect(baseTotalNII).not.toBe(0);
      expect(up200TotalNII).not.toBe(0);
    });

    it('computes net worth ratio for each projected quarter', async () => {
      const result = await mk([
        {
          category: 'asset',
          subcategory: 'residential_mortgage',
          name: 'Mortgages',
          balance: 400,
          rate: 0.055,
          duration: 10,
          rateType: 'fixed',
          depositBeta: null,
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'CDs',
          balance: 350,
          rate: 0.03,
          duration: 2,
          rateType: 'fixed',
          depositBeta: 0.8,
        },
      ]).runForwardSimulation({
        institutionId: 'inst_123',
        ratePaths: ['base'],
      });

      expect(result.quarters).toHaveLength(12);
      for (const q of result.quarters) {
        expect(typeof q.projectedNWR).toBe('number');
        const expectedNWR =
          ((q.totalAssets - q.totalLiabilities) / q.totalAssets) * 100;
        expect(q.projectedNWR).toBeCloseTo(expectedNWR, 0);
      }
    });

    it('summary year-3 cumulative NII exceeds year-1 with status ok', async () => {
      const result = await mk(realItems).runForwardSimulation({
        institutionId: 'inst_123',
      });
      expect(result.status).toBe('ok');
      expect(result.summary.baseNIIYear3!).toBeGreaterThan(
        result.summary.baseNIIYear1!,
      );
    });

    it('honors custom growth and prepayment assumptions', async () => {
      const result = await mk([
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Loans',
          balance: 200,
          rate: 0.06,
          duration: 3,
          rateType: 'fixed',
          depositBeta: null,
        },
        {
          category: 'liability',
          subcategory: 'savings',
          name: 'Savings',
          balance: 150,
          rate: 0.02,
          duration: 1,
          rateType: 'fixed',
          depositBeta: null,
        },
      ]).runForwardSimulation({
        institutionId: 'inst_123',
        growthAssumptions: { consumer_loans: 0.08 },
        prepaymentAssumptions: { consumer_loans: 0.1 },
        ratePaths: ['base'],
      });
      expect(result.quarters).toHaveLength(12);
      expect(result.config.growthAssumptions.consumer_loans).toBe(0.08);
    });
  });
});
