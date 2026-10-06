import { NIMAttributionService } from './nim-attribution.service';

describe('NIMAttributionService', () => {
  // priorNim: the most recent board report's nimSnapshot (the real prior). Pass
  // null/undefined to simulate no prior board report.
  const mk = (items: unknown[], priorNim?: number | null) =>
    new NIMAttributionService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
      boardReport: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            priorNim == null ? null : { nimSnapshot: priorNim },
          ),
      },
    } as any);

  const realItems = [
    {
      category: 'asset',
      subcategory: 'loans',
      name: 'Auto Loans',
      balance: 200,
      rate: 0.065,
      rateType: 'fixed',
    },
    {
      category: 'asset',
      subcategory: 'securities',
      name: 'Bond Portfolio',
      balance: 100,
      rate: 0.04,
      rateType: 'fixed',
    },
    {
      category: 'liability',
      subcategory: 'savings',
      name: 'Savings',
      balance: 150,
      rate: 0.015,
      rateType: 'variable',
    },
    {
      category: 'liability',
      subcategory: 'cds',
      name: 'CDs',
      balance: 100,
      rate: 0.035,
      rateType: 'fixed',
    },
  ];

  it('should be defined', () => {
    expect(mk([])).toBeDefined();
  });

  // ── D1: honest empty-data shells ───────────────────────────────

  it('returns data_unavailable (EMPTY_BALANCE_SHEET) when the balance sheet is empty', async () => {
    const result = await mk([]).computeAttribution('inst_123');

    expect(result.status).toBe('data_unavailable');
    expect(result.nimCurrent).toBeNull();
    expect(result.attribution).toEqual([]);
    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('nimAttribution.balanceSheet');
  });

  it('returns data_unavailable when there is no earning-asset base (no hardcoded 3.5)', async () => {
    const result = await mk([
      {
        category: 'liability',
        subcategory: 'savings',
        name: 'Savings',
        balance: 100,
        rate: 0.02,
        rateType: 'variable',
      },
    ]).computeAttribution('inst_123');

    expect(result.status).toBe('data_unavailable');
    expect(result.nimCurrent).toBeNull(); // never the former 3.5 fabrication
    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical!.reason).toBe('COSSEC_INPUTS_INSUFFICIENT');
    expect(critical!.field).toBe('nimAttribution.assets');
  });

  // ── D1: no prior board report → real current NIM, attribution gapped ──

  it('reports the real current NIM but gaps the attribution when no prior snapshot exists', async () => {
    const result = await mk(realItems, null).computeAttribution('inst_123');

    expect(result.status).toBe('ok');
    // current NIM is real and computed, not fabricated
    expect(result.nimCurrent).toBeCloseTo(3.75, 2);
    // ...but the change cannot be attributed without a prior baseline
    expect(result.nimPrior).toBeNull();
    expect(result.nimDeltaBps).toBeNull();
    expect(result.attribution).toEqual([]);
    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.field).toBe('nimAttribution.nimPrior');
  });

  // ── D1: real prior from board report → deterministic attribution ──

  it('attributes the real current-vs-prior NIM change into 7 factors (deterministic, no RNG)', async () => {
    const result = await mk(realItems, 3.6).computeAttribution('inst_123');

    expect(result.status).toBe('ok');
    expect(result.gaps).toBeUndefined();
    // NIM = (200*0.065 + 100*0.04 − 150*0.015 − 100*0.035) / 300 * 100 = 3.75%
    expect(result.nimCurrent).toBeCloseTo(3.75, 2);
    expect(result.nimPrior).toBeCloseTo(3.6, 2); // the real board-report prior
    expect(result.nimDeltaBps).toBe(15); // (3.75 − 3.60) * 100, exact (no RNG)
    expect(result.attribution).toHaveLength(7);

    const factorNames = result.attribution.map((f) => f.factor);
    expect(factorNames).toContain('Rate Environment');
    expect(factorNames).toContain('Deposit Beta');
    expect(factorNames).toContain('Credit Quality');
  });

  it('is deterministic across calls with the same inputs', async () => {
    const svc = mk(realItems, 3.6);
    const r1 = await svc.computeAttribution('inst_123');
    const r2 = await svc.computeAttribution('inst_123');
    expect(r1.nimPrior).toBe(r2.nimPrior);
    expect(r1.nimDeltaBps).toBe(r2.nimDeltaBps);
  });

  it('total explained bps plus residual equals nimDeltaBps', async () => {
    const result = await mk(
      [
        {
          category: 'asset',
          subcategory: 'loans',
          name: 'Loans',
          balance: 100,
          rate: 0.06,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'deposits',
          name: 'Deposits',
          balance: 80,
          rate: 0.02,
          rateType: 'variable',
        },
      ],
      3.0,
    ).computeAttribution('inst_123');

    expect(result.totalExplainedBps! + result.residualBps!).toBeCloseTo(
      result.nimDeltaBps!,
      10,
    );
  });

  it('provides Spanish translations and correct direction labels for all factors', async () => {
    const result = await mk(realItems, 2.0).computeAttribution('inst_123');

    for (const factor of result.attribution) {
      expect(factor.factorEs.length).toBeGreaterThan(0);
      expect(factor.explanationEs.length).toBeGreaterThan(0);
      if (factor.bps > 2) expect(factor.direction).toBe('positive');
      else if (factor.bps < -2) expect(factor.direction).toBe('negative');
      else expect(factor.direction).toBe('neutral');
    }
  });
});
