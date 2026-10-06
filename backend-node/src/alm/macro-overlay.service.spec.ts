import {
  MacroOverlayService,
  PR_MACRO_REFERENCE,
} from './macro-overlay.service';
import {
  PR_PD_MULTIPLIERS,
  PR_SCENARIO_WEIGHTS,
} from './cooperativa/product-registry';
import { PrMacroFeedService } from './pr-macro-feed.service';
import { PR_MACRO_SNAPSHOT } from './data/macro/pr-macro-snapshot';
import { DEFAULT_MACRO_STALENESS_DAYS } from './macro-overlay-config.util';

describe('MacroOverlayService — data-derived PR CECL overlay (W1.2)', () => {
  let svc: MacroOverlayService;

  beforeEach(() => {
    svc = new MacroOverlayService();
  });

  it('reduces EXACTLY to the provisional constants at the reference macro state (continuity)', () => {
    const r = svc.deriveOverlay({ ...PR_MACRO_REFERENCE, asOf: '2026-Q1' });
    expect(r.basis).toBe('derived-from-macro');
    expect(r.macroStressIndex).toBe(0);
    expect(r.pdMultipliers.adverse).toBeCloseTo(PR_PD_MULTIPLIERS.adverse, 6);
    expect(r.pdMultipliers.severely_adverse).toBeCloseTo(
      PR_PD_MULTIPLIERS.severely_adverse,
      6,
    );
    expect(r.scenarioWeights.baseline).toBeCloseTo(
      PR_SCENARIO_WEIGHTS.baseline,
      6,
    );
    expect(r.scenarioWeights.adverse).toBeCloseTo(
      PR_SCENARIO_WEIGHTS.adverse,
      6,
    );
    expect(r.scenarioWeights.severely_adverse).toBeCloseTo(
      PR_SCENARIO_WEIGHTS.severely_adverse,
      6,
    );
  });

  it('raises the multipliers as unemployment exceeds the reference (computed from data)', () => {
    // u=9 vs ref 6 → uStress=0.5, MSI=0.5*0.5=0.25.
    const r = svc.deriveOverlay({
      prUnemploymentPct: 9,
      prHpiYoyPct: 3,
      prNetMigrationPct: -1,
    });
    expect(r.macroStressIndex).toBeCloseTo(0.25, 6);
    expect(r.pdMultipliers.adverse).toBeCloseTo(2.1 * (1 + 0.5 * 0.25), 4); // 2.3625
    expect(r.pdMultipliers.severely_adverse).toBeCloseTo(
      3.6 * (1 + 0.7 * 0.25),
      4,
    ); // 4.23
  });

  it('raises the multipliers as HPI growth falls below reference', () => {
    const ref = svc.deriveOverlay(PR_MACRO_REFERENCE);
    const declining = svc.deriveOverlay({
      prUnemploymentPct: 6,
      prHpiYoyPct: -5, // home prices falling
      prNetMigrationPct: -1,
    });
    expect(declining.macroStressIndex!).toBeGreaterThan(ref.macroStressIndex!);
    expect(declining.pdMultipliers.adverse).toBeGreaterThan(
      ref.pdMultipliers.adverse,
    );
  });

  it('raises the multipliers as net out-migration worsens', () => {
    const worse = svc.deriveOverlay({
      prUnemploymentPct: 6,
      prHpiYoyPct: 3,
      prNetMigrationPct: -3, // ref -1 → more out-migration
    });
    expect(worse.macroStressIndex!).toBeGreaterThan(0);
    expect(worse.pdMultipliers.severely_adverse).toBeGreaterThan(
      PR_PD_MULTIPLIERS.severely_adverse,
    );
  });

  it('shifts scenario-weight mass toward the tail under stress; weights always sum to 1', () => {
    const r = svc.deriveOverlay({
      prUnemploymentPct: 12,
      prHpiYoyPct: -8,
      prNetMigrationPct: -4,
    });
    const w = r.scenarioWeights;
    expect(w.baseline).toBeLessThan(PR_SCENARIO_WEIGHTS.baseline);
    expect(w.adverse + w.severely_adverse).toBeGreaterThan(
      PR_SCENARIO_WEIGHTS.adverse + PR_SCENARIO_WEIGHTS.severely_adverse,
    );
    expect(w.baseline + w.adverse + w.severely_adverse).toBeCloseTo(1, 6);
  });

  it('clamps multipliers to disclosed maxima under extreme inputs', () => {
    const r = svc.deriveOverlay({
      prUnemploymentPct: 40,
      prHpiYoyPct: -50,
      prNetMigrationPct: -20,
    });
    expect(r.macroStressIndex).toBe(3); // MAX_MSI
    expect(r.pdMultipliers.adverse).toBe(4.0); // MAX_ADVERSE_MULT
    expect(r.pdMultipliers.severely_adverse).toBe(6.0); // MAX_SEVERE_MULT
  });

  describe('the W1.2 ratchet — never silently falls back to constants', () => {
    it('no inputs → hard-coded fallback with the constants + a WARNING gap', () => {
      const r = svc.deriveOverlay();
      expect(r.basis).toBe('hardcoded-fallback');
      expect(r.macroStressIndex).toBeNull();
      expect(r.pdMultipliers).toEqual({ ...PR_PD_MULTIPLIERS });
      expect(r.scenarioWeights).toEqual({ ...PR_SCENARIO_WEIGHTS });
      const gap = r.gaps.find((g) => g.field === 'cecl.macroOverlay');
      expect(gap?.severity).toBe('WARNING');
      expect(gap?.action).toMatch(/PROVISIONAL/);
    });

    it('invalid inputs (NaN / out-of-bounds) → fallback, never a silent constant', () => {
      expect(
        svc.deriveOverlay({
          prUnemploymentPct: NaN,
          prHpiYoyPct: 3,
          prNetMigrationPct: -1,
        }).basis,
      ).toBe('hardcoded-fallback');
      expect(
        svc.deriveOverlay({
          prUnemploymentPct: 999,
          prHpiYoyPct: 3,
          prNetMigrationPct: -1,
        }).basis,
      ).toBe('hardcoded-fallback');
    });

    it('the DERIVED path ALSO always emits a WARNING gap (both paths disclose)', () => {
      const r = svc.deriveOverlay(PR_MACRO_REFERENCE);
      const gap = r.gaps.find((g) => g.field === 'cecl.macroOverlay');
      expect(gap?.severity).toBe('WARNING');
      expect(gap?.context).toMatchObject({ basis: 'derived-from-macro' });
      expect(gap?.action).toMatch(/DERIVAD/); // Spanish-first "DERIVADOS"
    });
  });

  it('is deterministic — identical inputs produce identical output', () => {
    const a = svc.deriveOverlay({
      prUnemploymentPct: 8.4,
      prHpiYoyPct: 1.2,
      prNetMigrationPct: -1.8,
    });
    const b = svc.deriveOverlay({
      prUnemploymentPct: 8.4,
      prHpiYoyPct: 1.2,
      prNetMigrationPct: -1.8,
    });
    expect(a).toEqual(b);
  });

  describe('deriveCurrentOverlay — Slice 2, feed-fed (W1.2)', () => {
    const pinnedFeed = (daysAfterCompiled: number): PrMacroFeedService => {
      const feed = new PrMacroFeedService();
      const base = new Date(`${PR_MACRO_SNAPSHOT.compiledAsOf}T00:00:00Z`);
      feed.nowFn = () =>
        new Date(base.getTime() + daysAfterCompiled * 86_400_000);
      return feed;
    };

    beforeEach(() => {
      delete process.env.FRED_API_KEY;
      delete process.env.PR_MACRO_STALENESS_DAYS;
    });

    it('no feed injected → disclosed hard-coded fallback (never silent)', async () => {
      const r = await new MacroOverlayService().deriveCurrentOverlay();
      expect(r.basis).toBe('hardcoded-fallback');
      expect(r.gaps.some((g) => g.field === 'cecl.macroOverlay')).toBe(true);
    });

    it('with the committed snapshot → derived-from-macro at MSI 0 (current PR macro is benign)', async () => {
      const r = await new MacroOverlayService(
        pinnedFeed(1),
      ).deriveCurrentOverlay();
      expect(r.basis).toBe('derived-from-macro');
      // 2026-07 sourced data: 5.6% unemployment / +14.95% HPI / −0.09%
      // migration — all at-or-better than reference → zero stress → the
      // derived overlay equals the provisional constants exactly.
      expect(r.macroStressIndex).toBe(0);
      expect(r.pdMultipliers.adverse).toBeCloseTo(PR_PD_MULTIPLIERS.adverse, 6);
      expect(r.pdMultipliers.severely_adverse).toBeCloseTo(
        PR_PD_MULTIPLIERS.severely_adverse,
        6,
      );
      // Feed provenance is appended to the derivation provenance.
      expect(r.provenance).toContain('pr-macro-snapshot');
      expect(r.provenance).toContain(PR_MACRO_SNAPSHOT.compiledAsOf);
    });

    it('merges feed staleness gaps into the overlay result (one complete disclosure)', async () => {
      const r = await new MacroOverlayService(
        pinnedFeed(DEFAULT_MACRO_STALENESS_DAYS + 30),
      ).deriveCurrentOverlay();
      expect(r.basis).toBe('derived-from-macro');
      const fields = r.gaps.map((g) => g.field);
      expect(fields).toContain('cecl.macroOverlay'); // derivation disclosure
      expect(fields).toContain('cecl.macroOverlay.snapshot'); // staleness
    });

    it('broken feed → fallback + a CALCULATION_FAILED gap naming the feed', async () => {
      const broken = {
        getSnapshot: () => Promise.reject(new Error('feed exploded')),
        // type-rationale: minimal structural stub for the feed dependency
      } as unknown as PrMacroFeedService;
      const r = await new MacroOverlayService(broken).deriveCurrentOverlay();
      expect(r.basis).toBe('hardcoded-fallback');
      const gap = r.gaps.find((g) => g.field === 'cecl.macroOverlay.feed');
      expect(gap?.reason).toBe('CALCULATION_FAILED');
      expect(gap?.context).toMatchObject({ error: 'Error: feed exploded' });
    });

    it('is deterministic under a pinned clock', async () => {
      const a = await new MacroOverlayService(
        pinnedFeed(2),
      ).deriveCurrentOverlay();
      const b = await new MacroOverlayService(
        pinnedFeed(2),
      ).deriveCurrentOverlay();
      expect(a).toEqual(b);
    });
  });

  it('never produces a multiplier below its provisional base (stress only raises)', () => {
    // A "better than reference" macro state must not soften the overlay below base.
    const r = svc.deriveOverlay({
      prUnemploymentPct: 3,
      prHpiYoyPct: 10,
      prNetMigrationPct: 2,
    });
    expect(r.macroStressIndex).toBe(0);
    expect(r.pdMultipliers.adverse).toBeCloseTo(PR_PD_MULTIPLIERS.adverse, 6);
    expect(r.pdMultipliers.severely_adverse).toBeCloseTo(
      PR_PD_MULTIPLIERS.severely_adverse,
      6,
    );
  });
});
