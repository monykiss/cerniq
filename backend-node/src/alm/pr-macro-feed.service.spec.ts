import { PrMacroFeedService } from './pr-macro-feed.service';
import { PR_MACRO_SNAPSHOT } from './data/macro/pr-macro-snapshot';
import { DEFAULT_MACRO_STALENESS_DAYS } from './macro-overlay-config.util';

/** Day-offset helper against the snapshot's compiledAsOf. */
function daysAfterCompiled(days: number): Date {
  const base = new Date(`${PR_MACRO_SNAPSHOT.compiledAsOf}T00:00:00Z`);
  return new Date(base.getTime() + days * 86_400_000);
}

describe('PrMacroFeedService — committed PR macro snapshot feed (W1.2)', () => {
  let svc: PrMacroFeedService;

  beforeEach(() => {
    svc = new PrMacroFeedService();
    delete process.env.FRED_API_KEY;
    delete process.env.PR_MACRO_STALENESS_DAYS;
  });

  afterEach(() => {
    delete process.env.FRED_API_KEY;
    delete process.env.PR_MACRO_STALENESS_DAYS;
    // type-rationale: restoring the global fetch test double
    delete (global as any).fetch;
  });

  describe('committed snapshot path (no FRED key)', () => {
    it('serves the committed inputs with per-series provenance', async () => {
      svc.nowFn = () => daysAfterCompiled(1);
      const snap = await svc.getSnapshot();
      expect(snap.basis).toBe('committed-snapshot');
      expect(snap.inputs.prUnemploymentPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prUnemploymentPct,
      );
      expect(snap.inputs.prHpiYoyPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prHpiYoyPct,
      );
      expect(snap.inputs.prNetMigrationPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prNetMigrationPct,
      );
      expect(snap.inputs.asOf).toBe(PR_MACRO_SNAPSHOT.compiledAsOf);
      expect(snap.series).toHaveLength(3);
      expect(snap.series.map((s) => s.field).sort()).toEqual([
        'prHpiYoyPct',
        'prNetMigrationPct',
        'prUnemploymentPct',
      ]);
      // Every series carries a verifiable source pointer.
      for (const s of snap.series) {
        expect(s.sourceUrl).toMatch(/^https:\/\//);
        expect(s.asOf.length).toBeGreaterThan(0);
      }
    });

    it('fresh snapshot (within threshold) → no staleness gap', async () => {
      svc.nowFn = () => daysAfterCompiled(DEFAULT_MACRO_STALENESS_DAYS - 1);
      const snap = await svc.getSnapshot();
      expect(snap.gaps).toHaveLength(0);
    });

    it('stale snapshot (past threshold) → STALE_SNAPSHOT WARNING gap, data still served (D1)', async () => {
      svc.nowFn = () => daysAfterCompiled(DEFAULT_MACRO_STALENESS_DAYS + 10);
      const snap = await svc.getSnapshot();
      const gap = snap.gaps.find(
        (g) => g.field === 'cecl.macroOverlay.snapshot',
      );
      expect(gap?.reason).toBe('STALE_SNAPSHOT');
      expect(gap?.severity).toBe('WARNING');
      expect(gap?.context).toMatchObject({
        compiledAsOf: PR_MACRO_SNAPSHOT.compiledAsOf,
        ageDays: DEFAULT_MACRO_STALENESS_DAYS + 10,
        thresholdDays: DEFAULT_MACRO_STALENESS_DAYS,
      });
      // The W1.2 ratchet: stale discloses, never refuses.
      expect(snap.inputs.prUnemploymentPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prUnemploymentPct,
      );
    });

    it('honors PR_MACRO_STALENESS_DAYS override', async () => {
      process.env.PR_MACRO_STALENESS_DAYS = '30';
      svc.nowFn = () => daysAfterCompiled(31);
      const snap = await svc.getSnapshot();
      expect(
        snap.gaps.some((g) => g.field === 'cecl.macroOverlay.snapshot'),
      ).toBe(true);
    });

    it('is deterministic under a pinned clock — identical calls, identical snapshots', async () => {
      svc.nowFn = () => daysAfterCompiled(5);
      const a = await svc.getSnapshot();
      const b = await svc.getSnapshot();
      expect(a).toEqual(b);
    });
  });

  describe('FRED live refresh (unemployment only)', () => {
    it('overrides unemployment from PRURN and stamps the refresh in provenance', async () => {
      process.env.FRED_API_KEY = 'test-key';
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            observations: [{ date: '2026-06-01', value: '5.8' }],
          }),
      });
      // type-rationale: installing the global fetch test double
      (global as any).fetch = mockFetch;
      svc.nowFn = () => daysAfterCompiled(1);

      const snap = await svc.getSnapshot();
      expect(snap.basis).toBe('committed-snapshot+fred-refresh');
      expect(snap.inputs.prUnemploymentPct).toBe(5.8);
      // HPI + migration stay committed — no live path for them yet.
      expect(snap.inputs.prHpiYoyPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prHpiYoyPct,
      );
      expect(snap.provenance).toContain('FRED:PRURN');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = String(mockFetch.mock.calls[0][0]);
      expect(url).toContain('series_id=PRURN');
    });

    it('caches the PRURN observation for 4h against the pinned clock', async () => {
      process.env.FRED_API_KEY = 'test-key';
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            observations: [{ date: '2026-06-01', value: '5.8' }],
          }),
      });
      // type-rationale: installing the global fetch test double
      (global as any).fetch = mockFetch;
      svc.nowFn = () => daysAfterCompiled(1);

      await svc.getSnapshot();
      await svc.getSnapshot();
      expect(mockFetch).toHaveBeenCalledTimes(1); // second hit served from cache
    });

    it('refresh failure → committed value + WARNING gap, never silent (the W1.2 ratchet)', async () => {
      process.env.FRED_API_KEY = 'test-key';
      // type-rationale: installing the global fetch test double
      (global as any).fetch = jest
        .fn()
        .mockRejectedValue(new Error('FRED down'));
      svc.nowFn = () => daysAfterCompiled(1);

      const snap = await svc.getSnapshot();
      expect(snap.basis).toBe('committed-snapshot');
      expect(snap.inputs.prUnemploymentPct).toBe(
        PR_MACRO_SNAPSHOT.inputs.prUnemploymentPct,
      );
      const gap = snap.gaps.find(
        (g) => g.field === 'cecl.macroOverlay.unemployment',
      );
      expect(gap?.severity).toBe('WARNING');
      expect(gap?.context).toMatchObject({ refresh: 'FRED:PRURN' });
    });

    it('unparsable / out-of-bounds FRED observation → gap-disclosed fallback', async () => {
      process.env.FRED_API_KEY = 'test-key';
      // FRED encodes missing observations as value: "." — must not become 0.
      // type-rationale: installing the global fetch test double
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            observations: [{ date: '2026-06-01', value: '.' }],
          }),
      });
      svc.nowFn = () => daysAfterCompiled(1);

      const snap = await svc.getSnapshot();
      expect(snap.basis).toBe('committed-snapshot');
      expect(
        snap.gaps.some((g) => g.field === 'cecl.macroOverlay.unemployment'),
      ).toBe(true);
    });
  });

  describe('committed snapshot integrity', () => {
    it('inputs are within the overlay sanity bounds', () => {
      const { prUnemploymentPct, prHpiYoyPct, prNetMigrationPct } =
        PR_MACRO_SNAPSHOT.inputs;
      expect(prUnemploymentPct).toBeGreaterThanOrEqual(0);
      expect(prUnemploymentPct).toBeLessThanOrEqual(40);
      expect(prHpiYoyPct).toBeGreaterThanOrEqual(-50);
      expect(prHpiYoyPct).toBeLessThanOrEqual(50);
      expect(prNetMigrationPct).toBeGreaterThanOrEqual(-20);
      expect(prNetMigrationPct).toBeLessThanOrEqual(20);
    });

    it('every input field has a matching provenance series entry whose value agrees', () => {
      for (const [field, value] of Object.entries(PR_MACRO_SNAPSHOT.inputs)) {
        const series = PR_MACRO_SNAPSHOT.series.find((s) => s.field === field);
        expect(series).toBeDefined();
        expect(series?.value).toBe(value);
      }
    });

    it('compiledAsOf parses as a real date', () => {
      const t = new Date(`${PR_MACRO_SNAPSHOT.compiledAsOf}T00:00:00Z`);
      expect(Number.isFinite(t.getTime())).toBe(true);
    });
  });
});
