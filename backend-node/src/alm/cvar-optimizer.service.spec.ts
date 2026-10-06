import { CVaROptimizerService } from './cvar-optimizer.service';

describe('CVaROptimizerService', () => {
  const mk = (items: unknown[]) =>
    new CVaROptimizerService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
    } as any);

  // ── D1: honest empty-data shell (never the 6-asset demo) ───────

  describe('no assets (data_unavailable)', () => {
    let svc: CVaROptimizerService;
    beforeEach(() => {
      svc = mk([]);
    });

    it('returns a data_unavailable shell with null metrics + CRITICAL gap', async () => {
      const result = await svc.optimize('inst-1');
      expect(result.status).toBe('data_unavailable');
      expect(result.weights).toEqual([]);
      expect(result.assetNames).toEqual([]);
      expect(result.cvar).toBeNull();
      expect(result.var).toBeNull();
      expect(result.expectedReturn).toBeNull();
      expect(result.scenarioCount).toBe(0);
      expect(result.efficientFrontier).toEqual([]);

      const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
      expect(critical).toBeDefined();
      expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
      expect(critical!.field).toBe('cvarOptimizer.assets');
    });

    it('echoes the requested alpha even in the empty shell', async () => {
      expect((await svc.optimize('inst-1')).alpha).toBeCloseTo(0.05, 2);
      expect((await svc.optimize('inst-1', 0.01)).alpha).toBeCloseTo(0.01, 2);
    });
  });

  // ── D1: real-data optimization (unseeded MC → property-based) ──

  describe('with real balance sheet data', () => {
    let svcReal: CVaROptimizerService;

    beforeEach(() => {
      svcReal = mk([
        { category: 'asset', subcategory: 'cash', balance: 20, rate: 0.02 },
        {
          category: 'asset',
          subcategory: 'securities',
          balance: 40,
          rate: 0.045,
        },
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          balance: 60,
          rate: 0.065,
        },
        {
          category: 'asset',
          subcategory: 'mortgage',
          balance: 30,
          rate: 0.055,
        },
      ]);
    });

    it('returns status ok, no gaps, and weights per unique subcategory', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.weights).toHaveLength(4);
      expect(result.assetNames).toHaveLength(4);
    });

    it('weights sum to ~1 and are non-negative', async () => {
      const result = await svcReal.optimize('inst-1');
      const wSum = result.weights.reduce((s, w) => s + w, 0);
      expect(wSum).toBeCloseTo(1.0, 1);
      for (const w of result.weights) expect(w).toBeGreaterThanOrEqual(0);
    });

    it('CVaR is a finite number and expected return is positive', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(Number.isFinite(result.cvar)).toBe(true);
      expect(result.expectedReturn!).toBeGreaterThan(0);
    });

    it('produces a 5-point efficient frontier with non-decreasing target returns', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(result.efficientFrontier).toHaveLength(5);
      const targets = result.efficientFrontier.map((p) => p.targetReturn);
      for (let i = 1; i < targets.length; i++) {
        expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
      }
      for (const point of result.efficientFrontier) {
        const wSum = point.weights.reduce((s, w) => s + w, 0);
        expect(wSum).toBeCloseTo(1.0, 1);
      }
    });

    it('runs 500 Monte Carlo scenarios', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(result.scenarioCount).toBe(500);
    });
  });

  // ── Reproducibility (SR 11-7 model governance) ─────────────────

  describe('reproducibility + Decimal coercion', () => {
    const realItems = [
      { category: 'asset', subcategory: 'cash', balance: 20, rate: 0.02 },
      {
        category: 'asset',
        subcategory: 'securities',
        balance: 40,
        rate: 0.045,
      },
      {
        category: 'asset',
        subcategory: 'consumer_loans',
        balance: 60,
        rate: 0.065,
      },
      { category: 'asset', subcategory: 'mortgage', balance: 30, rate: 0.055 },
    ];

    it('is reproducible — same institution + data → byte-identical result', async () => {
      // The "optimal" allocation an examiner reads MUST reproduce. Two fresh
      // services, same inputs → identical scenarios, weights, CVaR, frontier.
      const a = await mk(realItems).optimize('inst-det');
      const b = await mk(realItems).optimize('inst-det');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('seeds by institution — a different id yields a different seeded scenario draw', async () => {
      // The PRNG stream is keyed by the institution id, so the CVaR/VaR pair
      // (driven by the scenario draws) differs across institutions.
      const x = await mk(realItems).optimize('inst-X');
      const y = await mk(realItems).optimize('inst-Y');
      expect(x.cvar).not.toBe(y.cvar);
    });

    it('coerces Prisma Decimal balances when aggregating a subcategory (no string-concat corruption)', async () => {
      // Prisma Decimal.valueOf() returns a STRING; the old `e.balance += item.balance`
      // therefore concatenated ("0"+"20"+"10" = "02010" → 2010) instead of summing
      // (30), corrupting every downstream return. Number()-coercion fixes it.
      const dec = (n: number) => ({
        valueOf: () => String(n),
        toString: () => String(n),
      });
      const r = await mk([
        {
          category: 'asset',
          subcategory: 'loans',
          balance: dec(20),
          rate: dec(0.05),
        },
        {
          category: 'asset',
          subcategory: 'loans',
          balance: dec(10),
          rate: dec(0.05),
        },
      ]).optimize('inst-dec');

      expect(r.status).toBe('ok');
      expect(r.assetNames).toEqual(['loans']);
      // Aggregated return = (0.05·20 + 0.05·10) / (20 + 10) = 0.05.
      // The string-concat bug would make balance 2010 → return ≈ 0.00075.
      expect(r.expectedReturn!).toBeCloseTo(0.05, 3);
    });

    it('skips a corrupt (non-finite) balance instead of fabricating a 0 move', async () => {
      const r = await mk([
        { category: 'asset', subcategory: 'cash', balance: NaN, rate: 0.02 },
        {
          category: 'asset',
          subcategory: 'securities',
          balance: 40,
          rate: 0.045,
        },
      ]).optimize('inst-nan');
      // Only the finite 'securities' row survives → one asset, status ok.
      expect(r.status).toBe('ok');
      expect(r.assetNames).toEqual(['securities']);
    });
  });
});
