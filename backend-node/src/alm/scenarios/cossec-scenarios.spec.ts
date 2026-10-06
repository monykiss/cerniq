/**
 * Contract specs for the COSSEC named-scenario library.
 *
 * These lock the static scenario data so a drifted entry (missing bilingual
 * field, wrong shock magnitude, duplicate id) fails CI rather than surfacing as
 * a wrong number in a regulator-facing stress report. Pure data — no DB, no
 * service. Pairs with `cossec-scenarios.ts`.
 *
 * The SIC 2026 block is the demo-scenario guard: the Mauldin "Global
 * Restructuring" scenario must stay exactly +200bps / +3% consumer default /
 * -5% deposit runoff, because the live demo narrative is built on the numbers
 * the engine derives from those shocks.
 */
import { COSSEC_SCENARIOS, NamedScenario } from './cossec-scenarios';

describe('COSSEC_SCENARIOS library', () => {
  it('every scenario has a unique id', () => {
    const ids = COSSEC_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every scenario carries both English and Spanish copy (Spanish-first contract)', () => {
    for (const s of COSSEC_SCENARIOS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.nameEs.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.descriptionEs.length).toBeGreaterThan(0);
      expect(s.regulatoryBasis.length).toBeGreaterThan(0);
    }
  });

  it('every scenario type is a known kind', () => {
    const known: NamedScenario['type'][] = [
      'parallel',
      'steepening',
      'flattening',
      'pr_specific',
      'macro',
    ];
    for (const s of COSSEC_SCENARIOS) {
      expect(known).toContain(s.type);
    }
  });

  it('shock magnitudes stay in defensible bounds', () => {
    for (const s of COSSEC_SCENARIOS) {
      expect(Math.abs(s.rateShiftBps)).toBeLessThanOrEqual(500);
      expect(Math.abs(s.depositShockPct)).toBeLessThanOrEqual(25);
      expect(Math.abs(s.creditShockPct)).toBeLessThanOrEqual(10);
    }
  });

  describe('SIC 2026 — Global Restructuring (Mauldin demo scenario)', () => {
    const sic = COSSEC_SCENARIOS.find(
      (s) => s.id === 'sic_2026_global_restructuring',
    );

    it('is registered in the library', () => {
      expect(sic).toBeDefined();
    });

    it('encodes the exact brief shocks: +200bps, +3% consumer default, -5% deposit runoff', () => {
      expect(sic).toBeDefined();
      // rate shock: +200bps parallel shift
      expect(sic!.rateShiftBps).toBe(200);
      // credit deterioration: +3% default-rate increase
      expect(sic!.creditShockPct).toBe(3);
      // deposit runoff: 5% outflow (negative = outflow per the field convention)
      expect(sic!.depositShockPct).toBe(-5);
      // and the +3% default shock lands on the consumer book specifically
      expect(sic!.creditShockSegment).toBe('consumer');
    });

    it('is typed as a combined macro shock (not a curve-shape or pr_specific scenario)', () => {
      // It must NOT be `parallel` or `pr_specific`: those sets are pinned by exact
      // assertions in stress-testing.service.spec — a macro type keeps it additive.
      expect(sic!.type).toBe('macro');
    });

    it('cites the SIC 2026 provenance and ships bilingual copy', () => {
      expect(sic!.regulatoryBasis).toMatch(/SIC 2026/i);
      expect(sic!.nameEs).toMatch(/Reestructuración Global/);
      expect(sic!.descriptionEs).toMatch(/200pbs/);
    });
  });
});
