import { PortfolioVaRService } from './portfolio-var.service';

// Build a service whose Prisma returns the given asset items and (optionally) a
// `MarketDataSnapshot` history. `balanceSheetItem.findMany` is
// `category: 'asset'`-scoped in the service, so the mock just echoes the list;
// `marketDataSnapshot.findMany` filters by `where.dataType` and returns the
// rows in ascending `asOfDate` order, mirroring the real Prisma query.
function makeService(
  items: any[],
  marketRows: any[] = [],
): PortfolioVaRService {
  const prisma = {
    balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
    marketDataSnapshot: {
      findMany: jest.fn(async ({ where }: any) =>
        marketRows
          .filter((r) => r.dataType === where?.dataType)
          .sort((a, b) =>
            a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : 0,
          ),
      ),
    },
  } as any;
  return new PortfolioVaRService(prisma);
}

// DV01 = Σ balance·duration/10000 = (100·3 + 200·5 + 50·1)/10000 = 0.135.
const REAL_ITEMS = [
  { balance: 100, duration: 3, category: 'asset' },
  { balance: 200, duration: 5, category: 'asset' },
  { balance: 50, duration: 1, category: 'asset' },
];

// ── Deterministic empirical-history fixture ──────────────────────────────────
// Build `days` daily snapshots of `driver` whose day-over-day moves follow a
// deterministic ramp cycling −25·amp … +24·amp bps. Because the change MULTISET
// is fully known, a test can predict the historical-simulation VaR BY HAND — the
// proof that EMPIRICAL changes (not a synthetic distribution) drive the result.
// No Math.random(): byte-reproducible across runs. `value` is the rate stored as
// a decimal fraction, exactly as the live feed writes it.
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2023, 0, 1);
function rampSeries(
  driver: string,
  days: number,
  ampBps = 1,
  startRate = 0.05,
): any[] {
  const rows: any[] = [
    {
      dataType: driver,
      value: startRate,
      asOfDate: new Date(EPOCH).toISOString(),
    },
  ];
  let v = startRate;
  for (let i = 0; i < days - 1; i++) {
    v += (((i % 50) - 25) * ampBps) / 10000; // change_i bps → fraction
    rows.push({
      dataType: driver,
      value: v,
      asOfDate: new Date(EPOCH + (i + 1) * DAY_MS).toISOString(),
    });
  }
  return rows;
}

// For the ramp with amp=1 over ≥250 changes: the 5%-quantile (index
// floor(0.05·250)=12) of −DV01·change lands on a +22bps move, so the 1-day 95%
// historical VaR = DV01·22 = 0.135·22 = 2.97. Derived independently of the impl.
const RAMP_HIST_VAR_95 = 0.135 * 22;

describe('PortfolioVaRService', () => {
  // ─── Input validation ───────────────────────────────────────
  it('rejects an invalid confidence level', async () => {
    await expect(
      makeService(REAL_ITEMS).computeVaRSuite('i', 0.9 as any, 1),
    ).rejects.toThrow('Invalid confidence level');
  });

  it('rejects an invalid horizon', async () => {
    await expect(
      makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 5 as any),
    ).rejects.toThrow('Invalid horizon');
  });

  // ─── Honest minimum: no fabricated numbers (D1) ─────────────
  it('empty balance sheet → data_unavailable shell, all VaR null, CRITICAL EMPTY_BALANCE_SHEET gap', async () => {
    const r = await makeService([]).computeVaRSuite('inst-empty', 0.95, 1);

    expect(r.status).toBe('data_unavailable');
    for (const m of [r.historical, r.parametric, r.montecarlo]) {
      expect(m.status).toBe('data_unavailable');
      expect(m.var).toBeNull();
      expect(m.cvar).toBeNull();
      expect(m.varPct).toBeNull();
      expect(m.portfolioValue).toBeNull();
    }
    expect(r.backtestResult.status).toBe('data_unavailable');
    expect(r.backtestResult.trafficLight).toBeNull();
    expect(r.backtestResult.kupiecLR).toBeNull();

    const crit = r.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(crit?.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(crit?.field).toBe('var');
    // The phantom $445M demo must be gone.
    expect(JSON.stringify(r)).not.toContain('445');
  });

  it('items present but zero total value → data_unavailable with MISSING_TOTAL_ASSETS (no $0 VaR theatre)', async () => {
    const r = await makeService([
      { balance: 0, duration: 3, category: 'asset' },
    ]).computeVaRSuite('inst-zero', 0.95, 1);

    expect(r.status).toBe('data_unavailable');
    expect(r.parametric.var).toBeNull();
    expect(
      r.gaps?.some(
        (g) => g.reason === 'MISSING_TOTAL_ASSETS' && g.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  // ─── No empirical market history: withhold, never fabricate ──
  it('no market history → historical + Monte Carlo VaR data_unavailable, parametric falls back, STALE_SNAPSHOT disclosed', async () => {
    const r = await makeService(REAL_ITEMS).computeVaRSuite(
      'inst-nohist',
      0.95,
      1,
    );

    // Report still renders off the real portfolio → top-level ok.
    expect(r.status).toBe('ok');

    // The two market-history methods are withheld — null, not synthetic.
    expect(r.historical.status).toBe('data_unavailable');
    expect(r.historical.var).toBeNull();
    expect(r.montecarlo.status).toBe('data_unavailable');
    expect(r.montecarlo.var).toBeNull();
    expect(r.backtestResult.status).toBe('data_unavailable');
    expect(r.backtestResult.trafficLight).toBeNull();

    // Parametric still renders off the REAL DV01 with a disclosed fixed vol.
    expect(r.parametric.status).toBe('ok');
    expect(r.parametric.var).toBeGreaterThan(0);

    // Honest disclosure: history methods → STALE_SNAPSHOT; parametric →
    // INDICATOR_NOT_WIRED (fixed-vol fallback). None CRITICAL (report renders).
    const reasons = (r.gaps ?? []).map((g) => `${g.field}:${g.reason}`);
    expect(reasons).toContain('var.historical:STALE_SNAPSHOT');
    expect(reasons).toContain('var.montecarlo:STALE_SNAPSHOT');
    expect(reasons).toContain('backtest:STALE_SNAPSHOT');
    expect(reasons).toContain('var.parametric:INDICATOR_NOT_WIRED');
    expect(r.gaps?.every((g) => g.severity === 'WARNING')).toBe(true);

    // Labels stay honest; the phantom $445M demo never appears.
    expect(r.historical.method).toBe('historical');
    expect((r as any).simulated).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('445');
  });

  // ─── Empirical path: real moves drive the VaR ───────────────
  it('uses EMPIRICAL day-over-day moves for the historical-simulation VaR (hand-derived 2.97)', async () => {
    // 251 daily obs → 250 changes (the VaR window); below the 500-change floor
    // for an out-of-sample backtest, so the VaR is empirical but the backtest
    // is honestly withheld.
    const r = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 251),
    ).computeVaRSuite('inst-emp', 0.95, 1);

    expect(r.status).toBe('ok');
    expect(r.historical.status).toBe('ok');
    expect(r.historical.method).toBe('historical');
    // The empirical change set pins the VaR to DV01·22 = 2.97 — a synthetic
    // distribution would land elsewhere.
    expect(r.historical.var).toBeCloseTo(RAMP_HIST_VAR_95, 2);

    // Now that real data backs them, the historical + MC INDICATOR_NOT_WIRED
    // disclosures are gone.
    const notWired = (r.gaps ?? []).filter(
      (g) => g.reason === 'INDICATOR_NOT_WIRED',
    );
    expect(notWired).toHaveLength(0);
    expect(r.montecarlo.status).toBe('ok');

    // 250 changes < 500 → backtest withheld (out-of-sample needs more history).
    expect(r.backtestResult.status).toBe('data_unavailable');
    expect(
      (r.gaps ?? []).some(
        (g) => g.field === 'backtest' && g.reason === 'STALE_SNAPSHOT',
      ),
    ).toBe(true);
  });

  it('empirical VaR magnitude scales with the empirical move size', async () => {
    const r1 = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 251, 1),
    ).computeVaRSuite('inst-amp1', 0.95, 1);
    const r2 = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 251, 2),
    ).computeVaRSuite('inst-amp2', 0.95, 1);

    // Doubling every empirical daily move doubles the historical-sim VaR.
    expect(r2.historical.var!).toBeCloseTo(2 * r1.historical.var!, 2);
  });

  it('parametric VaR uses the EMPIRICAL daily vol when history is present (differs from the fixed-vol fallback)', async () => {
    const fixed = await makeService(REAL_ITEMS).computeVaRSuite(
      'inst-fixed',
      0.95,
      1,
    );
    const empirical = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 251),
    ).computeVaRSuite('inst-empvol', 0.95, 1);

    // The ramp's empirical daily vol (~14bps) ≠ the fixed 5bps fallback, so the
    // parametric VaR is genuinely market-calibrated, not the fixed assumption.
    expect(empirical.parametric.var).not.toBe(fixed.parametric.var);
    expect(empirical.parametric.var!).toBeGreaterThan(fixed.parametric.var!);
  });

  it('runs a GENUINE out-of-sample Kupiec backtest once ≥500 daily moves exist', async () => {
    // 520 obs → 519 changes ≥ 500 → 250-day walk-forward backtest with a
    // 250-day rolling estimation window.
    const r = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 520),
    ).computeVaRSuite('inst-bt', 0.95, 1);

    expect(r.backtestResult.status).toBe('ok');
    expect(r.backtestResult.testDays).toBe(250);
    expect(['GREEN', 'AMBER', 'RED']).toContain(r.backtestResult.trafficLight);
    expect(typeof r.backtestResult.exceptions).toBe('number');
    expect(Number.isFinite(r.backtestResult.kupiecLR!)).toBe(true);
    // Fully empirical now → no INDICATOR_NOT_WIRED, no STALE_SNAPSHOT.
    expect(r.gaps ?? []).toHaveLength(0);
  });

  it('99% backtest applies the Basel 99% traffic-light bands', async () => {
    const r = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 520),
    ).computeVaRSuite('inst-bt99', 0.99, 1);

    expect(r.backtestResult.status).toBe('ok');
    expect(r.backtestResult.expectedExceptions).toBeCloseTo(2.5, 1);
    expect(['GREEN', 'AMBER', 'RED']).toContain(r.backtestResult.trafficLight);
    expect(r.backtestResult.exceptions).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.backtestResult.kupiecLR!)).toBe(true);
  });

  // ─── Honest degradation on a DB error (never a synthetic fallback) ──
  it('a MarketDataSnapshot query failure is logged and degrades to data_unavailable, not a synthetic VaR', async () => {
    const prisma = {
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(REAL_ITEMS) },
      marketDataSnapshot: {
        findMany: jest.fn().mockRejectedValue(new Error('relation missing')),
      },
    } as any;
    const r = await new PortfolioVaRService(prisma).computeVaRSuite(
      'inst-dberr',
      0.95,
      1,
    );

    // The empirical methods are withheld — never fabricated from the failure.
    expect(r.historical.status).toBe('data_unavailable');
    expect(r.montecarlo.status).toBe('data_unavailable');
    expect(r.backtestResult.status).toBe('data_unavailable');
    // The real-DV01 parametric method still renders (fixed-vol fallback).
    expect(r.parametric.status).toBe('ok');
    expect(r.status).toBe('ok');
    expect(JSON.stringify(r)).not.toContain('445');
  });

  it('insufficient history (<250 changes) → data_unavailable, never a synthetic VaR or phantom total', async () => {
    const r = await makeService(
      REAL_ITEMS,
      rampSeries('FED_FUNDS', 100),
    ).computeVaRSuite('inst-thin', 0.95, 1);

    expect(r.historical.status).toBe('data_unavailable');
    expect(r.historical.var).toBeNull();
    expect(r.montecarlo.var).toBeNull();
    expect(JSON.stringify(r)).not.toContain('445');
  });

  // ─── Reproducibility (SR 11-7 model governance) ─────────────
  it('is reproducible — two calls with the same inputs are byte-identical (no-history path)', async () => {
    const a = await makeService(REAL_ITEMS).computeVaRSuite(
      'inst-det',
      0.99,
      10,
    );
    const b = await makeService(REAL_ITEMS).computeVaRSuite(
      'inst-det',
      0.99,
      10,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is reproducible with empirical data — seeded Monte Carlo is byte-identical', async () => {
    const series = rampSeries('FED_FUNDS', 520);
    const a = await makeService(REAL_ITEMS, series).computeVaRSuite(
      'inst-detemp',
      0.99,
      10,
    );
    const b = await makeService(REAL_ITEMS, series).computeVaRSuite(
      'inst-detemp',
      0.99,
      10,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('seeds Monte Carlo by institution — same empirical history, different id → different MC draws; parametric + historical are seed-independent', async () => {
    const series = rampSeries('FED_FUNDS', 520);
    const x = await makeService(REAL_ITEMS, series).computeVaRSuite(
      'inst-A',
      0.95,
      1,
    );
    const y = await makeService(REAL_ITEMS, series).computeVaRSuite(
      'inst-B',
      0.95,
      1,
    );

    // Closed-form parametric + deterministic historical depend only on the data.
    expect(x.parametric.var).toBe(y.parametric.var);
    expect(x.historical.var).toBe(y.historical.var);
    // Seeded Monte Carlo depends on the institution hash → differs.
    expect(x.montecarlo.var).not.toBe(y.montecarlo.var);
  });

  // ─── The fixed-vol fallback method (no history) ─────────────
  it('parametric VaR uses the real balance-sheet DV01 with the fixed-vol fallback (closed form)', async () => {
    const r = await makeService(REAL_ITEMS).computeVaRSuite(
      'inst-dv01',
      0.95,
      1,
    );
    // VaR = z·(DV01·5bps)·√h = 1.645 · (0.135·5) · 1 = 1.11
    expect(r.parametric.var).toBeCloseTo(1.11, 2);
    expect(r.parametric.portfolioValue).toBe(350);
    expect(r.parametric.status).toBe('ok');
  });

  it('coerces Prisma Decimal balances instead of silently zeroing them', async () => {
    // Prisma returns Decimal objects, not plain numbers. Number()-coercion is
    // what makes the parametric VaR real in production.
    const dec = (n: number) => ({
      valueOf: () => n,
      toString: () => String(n),
    });
    const r = await makeService([
      { balance: dec(100), duration: dec(3), category: 'asset' },
      { balance: dec(200), duration: dec(5), category: 'asset' },
    ]).computeVaRSuite('inst-dec', 0.95, 1);

    expect(r.status).toBe('ok');
    expect(r.parametric.portfolioValue).toBe(300);
    expect(r.parametric.var!).toBeGreaterThan(0);
  });

  // ─── Method labels + VaR invariants ─────────────────────────
  it('returns all three methods with honest labels', async () => {
    const r = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 1);
    expect(r.historical.method).toBe('historical');
    expect(r.parametric.method).toBe('parametric');
    expect(r.montecarlo.method).toBe('montecarlo');
  });

  it('VaR is positive and CVaR >= VaR (expected shortfall is worse)', async () => {
    const r = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 1);
    expect(r.parametric.var!).toBeGreaterThan(0);
    expect(r.parametric.cvar!).toBeGreaterThanOrEqual(r.parametric.var!);
  });

  it('99% VaR exceeds 95% VaR (parametric)', async () => {
    const r95 = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 1);
    const r99 = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.99, 1);
    expect(r99.parametric.var!).toBeGreaterThan(r95.parametric.var!);
  });

  it('10-day VaR exceeds 1-day VaR (parametric)', async () => {
    const r1 = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 1);
    const r10 = await makeService(REAL_ITEMS).computeVaRSuite('i', 0.95, 10);
    expect(r10.parametric.var!).toBeGreaterThan(r1.parametric.var!);
  });

  it('tolerates NaN / infinite balances (treated as 0 balance / unit duration)', async () => {
    const r = await makeService([
      { balance: NaN, duration: 3, category: 'asset' },
      { balance: 100, duration: Infinity, category: 'asset' },
    ]).computeVaRSuite('i', 0.95, 1);
    // Only the finite 100 balance contributes → portfolioValue 100, status ok.
    expect(r.status).toBe('ok');
    expect(r.parametric.portfolioValue).toBe(100);
  });
});
