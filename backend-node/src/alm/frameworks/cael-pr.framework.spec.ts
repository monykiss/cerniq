import {
  CAEL_PR_7790_FRAMEWORK,
  CAEL_PR_CECL_FRAMEWORK,
  CAEL_PR_PILOTO_FRAMEWORK,
  CAEL_PR_FRAMEWORKS,
  getCaelFramework,
  type CaelFramework,
  type CaelVariant,
} from './cael-pr.framework';
import { getFramework } from './index';
import { COSSEC_PR_FRAMEWORK } from './cossec-pr.framework';
import { NCUA_US_FRAMEWORK } from './ncua-us.framework';

describe('CAEL-PR framework (Wave 1 W1.1)', () => {
  const ALL: Array<[CaelVariant, CaelFramework]> = [
    ['reg7790', CAEL_PR_7790_FRAMEWORK],
    ['cecl', CAEL_PR_CECL_FRAMEWORK],
    ['piloto', CAEL_PR_PILOTO_FRAMEWORK],
  ];

  it('defines exactly three variants with distinct ids', () => {
    const ids = ALL.map(([, f]) => f.id);
    expect(ids).toEqual(['cael-pr-7790', 'cael-pr-cecl', 'cael-pr-piloto']);
    expect(new Set(ids).size).toBe(3);
  });

  describe.each(ALL)('variant %s', (variant, fw) => {
    it('tags the correct variant', () => {
      expect(fw.variant).toBe(variant);
    });

    it('covers exactly the CAEL components C / A / E / L (no Management)', () => {
      const categories = fw.ratios.map((r) => r.category).sort();
      expect(categories).toEqual([
        'asset_quality',
        'capital',
        'earnings',
        'liquidity',
      ]);
      expect(categories).not.toContain('management');
    });

    it('weights sum to exactly 100', () => {
      const sum = fw.ratios.reduce((acc, r) => acc + r.weight, 0);
      expect(sum).toBe(100);
    });

    it('is fully bilingual (framework + every ratio)', () => {
      expect(fw.name.length).toBeGreaterThan(0);
      expect(fw.nameEs.length).toBeGreaterThan(0);
      expect(fw.provenance).toMatch(/\//); // bilingual "es / en"
      for (const r of fw.ratios) {
        expect(r.name.length).toBeGreaterThan(0);
        expect(r.nameEs.length).toBeGreaterThan(0);
      }
    });

    it('gives every ratio an honest source + provisional flag (D1 disclosure)', () => {
      for (const r of fw.ratios) {
        expect(typeof r.source).toBe('string');
        expect(r.source.length).toBeGreaterThan(0);
        expect(typeof r.provisional).toBe('boolean');
      }
    });

    it('marks statutorily-grounded thresholds as NOT provisional', () => {
      // CC-2021-02 liquidity 5% is a real floor → must not be flagged provisional.
      const liquidity = fw.ratios.find((r) => r.category === 'liquidity')!;
      expect(liquidity.provisional).toBe(false);
      expect(liquidity.source).toMatch(/CC-2021-02/);
    });

    it('marks UNVERIFIED CAEL-band thresholds as provisional', () => {
      // Asset-quality + earnings bands derive from the non-OCR Reg 7790 scan.
      const assetQuality = fw.ratios.find(
        (r) => r.category === 'asset_quality',
      )!;
      const earnings = fw.ratios.find((r) => r.category === 'earnings')!;
      expect(assetQuality.provisional).toBe(true);
      expect(earnings.provisional).toBe(true);
    });
  });

  it('7790 + CECL share the indivisible-capital (RWA, 8%) leg; Piloto uses Net Equity (4%)', () => {
    const cap7790 = CAEL_PR_7790_FRAMEWORK.ratios.find(
      (r) => r.category === 'capital',
    )!;
    const capCecl = CAEL_PR_CECL_FRAMEWORK.ratios.find(
      (r) => r.category === 'capital',
    )!;
    const capPiloto = CAEL_PR_PILOTO_FRAMEWORK.ratios.find(
      (r) => r.category === 'capital',
    )!;

    expect(cap7790.threshold).toBe('>= 8%');
    expect(cap7790.source).toMatch(/Ley 255/);
    expect(cap7790).toEqual(capCecl); // identical capital leg

    // Piloto is the simple leverage ratio, phasing to 4% — NOT the RWA ratio.
    expect(capPiloto.name).toMatch(/Net Equity/);
    expect(capPiloto.threshold).toBe('>= 4%');
    expect(capPiloto.provisional).toBe(true);
  });

  it('encodes the loss-measurement basis that distinguishes the variants', () => {
    expect(CAEL_PR_7790_FRAMEWORK.lossBasis).toBe('incurred-loss');
    expect(CAEL_PR_CECL_FRAMEWORK.lossBasis).toBe('cecl');
    expect(CAEL_PR_PILOTO_FRAMEWORK.lossBasis).toBe('n/a');
  });

  it('shares the A/E/L legs by reference across variants (cannot drift apart)', () => {
    const aq = (f: CaelFramework) =>
      f.ratios.find((r) => r.category === 'asset_quality');
    expect(aq(CAEL_PR_7790_FRAMEWORK)).toBe(aq(CAEL_PR_CECL_FRAMEWORK));
    expect(aq(CAEL_PR_7790_FRAMEWORK)).toBe(aq(CAEL_PR_PILOTO_FRAMEWORK));
  });

  describe('getCaelFramework', () => {
    it.each(ALL)('resolves variant %s', (variant, fw) => {
      expect(getCaelFramework(variant)).toBe(fw);
    });

    it('the registry record matches the named exports', () => {
      expect(CAEL_PR_FRAMEWORKS.reg7790).toBe(CAEL_PR_7790_FRAMEWORK);
      expect(CAEL_PR_FRAMEWORKS.cecl).toBe(CAEL_PR_CECL_FRAMEWORK);
      expect(CAEL_PR_FRAMEWORKS.piloto).toBe(CAEL_PR_PILOTO_FRAMEWORK);
    });
  });

  describe('getFramework() registry wiring', () => {
    it("maps 'CAEL' to the base (Reglamento 7790) variant", () => {
      expect(getFramework('CAEL')).toBe(CAEL_PR_7790_FRAMEWORK);
      expect(getFramework('cael')).toBe(CAEL_PR_7790_FRAMEWORK); // case-insensitive
    });

    it('does not regress the existing COSSEC / NCUA resolution', () => {
      expect(getFramework('COSSEC')).toBe(COSSEC_PR_FRAMEWORK);
      expect(getFramework('NCUA')).toBe(NCUA_US_FRAMEWORK);
      expect(getFramework('unknown')).toBe(COSSEC_PR_FRAMEWORK); // default
    });
  });
});
