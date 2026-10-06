/**
 * Specs for the seeded capital-ratio-under-stress projection.
 *
 * Assertions are relationship-based: the deterministic centre equals
 * (equity − losses)/assets, the band is centred on it, more loss ⇒ lower ratio
 * and higher breach probability, and the whole thing is reproducible from the
 * seed (SR 11-7). No frozen output literals.
 */
import {
  projectCapitalRatioUnderStress,
  reverseStressToFloor,
  CapitalRatioProjectionInput,
} from './capital-ratio-projection';

const BASE: CapitalRatioProjectionInput = {
  baseEquity: 25,
  totalAssets: 250,
  cossecMinimumPct: 7,
  deterministicLosses: { creditLoss: 2.4, depositCost: 0.16, niiShortfall: 0 },
  seed: 'sic:test',
  paths: 5000,
};

describe('projectCapitalRatioUnderStress', () => {
  it('baseline capital ratio = equity / total assets', () => {
    expect(
      projectCapitalRatioUnderStress(BASE).baselineCapitalRatioPct,
    ).toBeCloseTo((BASE.baseEquity / BASE.totalAssets) * 100, 6);
  });

  it('deterministic stressed ratio = (equity − total loss) / assets', () => {
    const r = projectCapitalRatioUnderStress(BASE);
    const totalLoss = 2.4 + 0.16 + 0;
    expect(r.deterministic.totalLoss).toBeCloseTo(totalLoss, 6);
    expect(r.deterministic.stressedCapitalRatioPct).toBeCloseTo(
      ((BASE.baseEquity - totalLoss) / BASE.totalAssets) * 100,
      2,
    );
  });

  it('the band is centred on the deterministic estimate (mean = centre, lognormal mean-1)', () => {
    const r = projectCapitalRatioUnderStress(BASE);
    // mean-1 lognormal severities ⇒ E[stressed ratio] = deterministic centre.
    expect(
      Math.abs(r.meanCapitalRatioPct - r.deterministic.stressedCapitalRatioPct),
    ).toBeLessThan(0.1);
  });

  it('percentiles are ordered p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95', () => {
    const d = projectCapitalRatioUnderStress(BASE).distribution;
    expect(d.p5).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.p50);
    expect(d.p50).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.p95);
  });

  it('lognormal severities keep every path below baseline — stress only erodes capital', () => {
    // Severity > 0 always (no truncation), so loss > 0 on every path ⇒ even the
    // benign tail (p95) sits below baseline. The adverse tail (p5) is well below.
    const r = projectCapitalRatioUnderStress(BASE);
    expect(r.distribution.p95).toBeLessThan(r.baselineCapitalRatioPct);
    expect(r.distribution.p5).toBeLessThan(r.distribution.p95);
  });

  it('systemic correlation fattens the adverse tail (ρ↑ ⇒ p5↓, no diversification)', () => {
    // With three comparable loss channels, independent draws diversify and lift
    // p5; a shared systemic factor makes them worsen together and lowers it.
    const losses = { creditLoss: 6, depositCost: 6, niiShortfall: 6 };
    const independent = projectCapitalRatioUnderStress({
      ...BASE,
      deterministicLosses: losses,
      assumptions: { systemicCorrelation: 0 },
    });
    const correlated = projectCapitalRatioUnderStress({
      ...BASE,
      deterministicLosses: losses,
      assumptions: { systemicCorrelation: 0.95 },
    });
    expect(correlated.distribution.p5).toBeLessThan(
      independent.distribution.p5,
    );
    // but the mean is unaffected by correlation (correlation moves variance, not mean)
    expect(correlated.meanCapitalRatioPct).toBeCloseTo(
      independent.meanCapitalRatioPct,
      0,
    );
  });

  it('is reproducible — same seed yields a deep-equal result (SR 11-7)', () => {
    expect(projectCapitalRatioUnderStress(BASE)).toEqual(
      projectCapitalRatioUnderStress(BASE),
    );
  });

  it('a different seed keeps the centre but redraws the band', () => {
    const a = projectCapitalRatioUnderStress(BASE);
    const b = projectCapitalRatioUnderStress({ ...BASE, seed: 'sic:other' });
    expect(b.deterministic.stressedCapitalRatioPct).toBeCloseTo(
      a.deterministic.stressedCapitalRatioPct,
      6,
    );
    expect(b.distribution).not.toEqual(a.distribution);
  });

  it('larger losses ⇒ lower stressed ratio and ≥ breach probability', () => {
    const mild = projectCapitalRatioUnderStress(BASE);
    const severe = projectCapitalRatioUnderStress({
      ...BASE,
      deterministicLosses: { creditLoss: 12, depositCost: 2, niiShortfall: 3 },
    });
    expect(severe.deterministic.stressedCapitalRatioPct).toBeLessThan(
      mild.deterministic.stressedCapitalRatioPct,
    );
    expect(severe.breachProbabilityPct).toBeGreaterThanOrEqual(
      mild.breachProbabilityPct,
    );
  });

  it('flags a breach when losses push the centre below the floor', () => {
    // equity 25 / assets 250, floor 7% ⇒ a $9M loss → 6.4% < 7%.
    const r = projectCapitalRatioUnderStress({
      ...BASE,
      deterministicLosses: { creditLoss: 9, depositCost: 0, niiShortfall: 0 },
    });
    expect(r.deterministic.stressedCapitalRatioPct).toBeLessThan(7);
    expect(r.breachesFloorAtAdverseTail).toBe(true);
    expect(r.breachProbabilityPct).toBeGreaterThan(50);
  });

  it('discloses its model assumptions (seed, CVs, parametric basis)', () => {
    const r = projectCapitalRatioUnderStress(BASE);
    expect(r.disclosures.length).toBeGreaterThan(0);
    expect(r.disclosures.join(' ')).toMatch(/seed/i);
    expect(r.disclosures.join(' ')).toMatch(/parametric|CV/i);
  });

  it('degenerate zero-asset input yields 0 ratios without NaN or throwing', () => {
    const r = projectCapitalRatioUnderStress({ ...BASE, totalAssets: 0 });
    expect(r.baselineCapitalRatioPct).toBe(0);
    expect(r.deterministic.stressedCapitalRatioPct).toBe(0);
    expect(Number.isFinite(r.distribution.p5)).toBe(true);
    expect(Number.isFinite(r.meanCapitalRatioPct)).toBe(true);
  });
});

describe('reverseStressToFloor', () => {
  // equity 25 / assets 250, floor 7% ⇒ floor equity 17.5 ⇒ absorbs 7.5 before breach.
  const base = {
    baseEquity: 25,
    totalAssets: 250,
    cossecMinimumPct: 7,
    scenarioTotalLoss: 2.5,
    targetSegmentBalance: 80,
  };

  it('loss-to-floor = equity − floor×assets', () => {
    const r = reverseStressToFloor(base);
    expect(r.lossToFloor).toBeCloseTo(25 - 0.07 * 250, 6); // 7.5
    expect(r.alreadyBelowFloor).toBe(false);
  });

  it('headroom multiple = loss-to-floor / scenario loss', () => {
    const r = reverseStressToFloor(base);
    expect(r.headroomMultiple).toBeCloseTo(7.5 / 2.5, 2); // 3.0×
  });

  it('breaking-point segment default = loss-to-floor / segment balance', () => {
    const r = reverseStressToFloor(base);
    expect(r.breakingPointSegmentDefaultPct).toBeCloseTo((7.5 / 80) * 100, 1); // 9.375% → round2 9.38
  });

  it('flags an institution already below the floor (negative headroom)', () => {
    const r = reverseStressToFloor({ ...base, baseEquity: 15 }); // 15 < 17.5
    expect(r.alreadyBelowFloor).toBe(true);
    expect(r.lossToFloor).toBeLessThan(0);
    expect(r.headroomMultiple).toBe(0); // clamped — no headroom
  });

  it('returns null multiples when the divisors are absent', () => {
    const r = reverseStressToFloor({
      baseEquity: 25,
      totalAssets: 250,
      cossecMinimumPct: 7,
      scenarioTotalLoss: 0,
    });
    expect(r.headroomMultiple).toBeNull();
    expect(r.breakingPointSegmentDefaultPct).toBeNull();
  });
});
