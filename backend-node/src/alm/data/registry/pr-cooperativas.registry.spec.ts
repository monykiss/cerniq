import {
  loadPrCooperativaRegistry,
  verifyPrCooperativaRegistry,
} from './pr-cooperativas.registry';

describe('pr-cooperativas registry', () => {
  it('loads 91 COSSEC-insured cooperativas from Anejo 9', () => {
    const registry = loadPrCooperativaRegistry();
    expect(registry.institutions).toHaveLength(91);
    expect(registry.meta.expectedCount).toBe(91);
  });

  it('passes the verify gate (count, top-20, no Aguada, tier math)', () => {
    const result = verifyPrCooperativaRegistry();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.hasAguada).toBe(false);
    expect(result.missingTop20).toEqual([]);
    // market research notes concentration: 40 >$100M, 20 at $50–100M, 31 remainder
    expect(result.tierCounts.tier1).toBe(40);
    expect(result.tierCounts.tier2).toBe(20);
    expect(result.tierCounts.tier3).toBe(31);
  });

  it('ranks Rincón / COOPACA / CrediCentro first by assets', () => {
    const top = loadPrCooperativaRegistry().institutions.slice(0, 3);
    expect(top[0]?.displayName).toMatch(/Rincón/i);
    expect(top[1]?.displayName).toMatch(/COOPACA/i);
    expect(top[2]?.displayName).toMatch(/CrediCentro/i);
    expect(top[0]?.cossecCharter).toBe('007');
  });
});
