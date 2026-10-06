import { PCAYieldCurveService } from './pca-yield-curve.service';

describe('PCAYieldCurveService', () => {
  let service: PCAYieldCurveService;

  beforeEach(() => {
    service = new PCAYieldCurveService();
  });

  const baseRates = [
    0.048, 0.046, 0.044, 0.042, 0.041, 0.04, 0.041, 0.042, 0.045, 0.046,
  ];

  // ── D1: honest insufficient-data shell (never the 99.1% demo) ──

  it('returns a data_unavailable shell with a WARNING gap for insufficient data', () => {
    const result = service.computePCAFactors([]);

    expect(result.status).toBe('data_unavailable');
    expect(result.factors).toEqual([]);
    expect(result.totalExplainedPct).toBeNull();
    expect(result.tenorLabels).toEqual([]);

    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.reason).toBe('STRESS_INPUTS_INSUFFICIENT');
    expect(warning!.field).toBe('pcaYieldCurve.yieldChanges');
  });

  // ── D1: real-data PCA decomposition ────────────────────────────

  it('computes 3 PCA factors from a sufficient yield-change series with status ok', () => {
    const changes = service.generateSyntheticChanges(baseRates, 100);
    const result = service.computePCAFactors(changes);

    expect(result.status).toBe('ok');
    expect(result.gaps).toBeUndefined();
    expect(result.factors).toHaveLength(3);
    expect(result.factors[0].name).toBe('Level');
    expect(result.factors[1].name).toBe('Slope');
    expect(result.factors[2].name).toBe('Curvature');
    expect(result.factors[0].explainedVariancePct).toBeGreaterThan(50);
  });

  it('Level factor explains the most variance', () => {
    const changes = service.generateSyntheticChanges(baseRates, 100);
    const result = service.computePCAFactors(changes);
    expect(result.factors[0].explainedVariancePct).toBeGreaterThan(
      result.factors[1].explainedVariancePct,
    );
  });

  it('attributeDV01 returns level, slope, curvature from computed factors', () => {
    const changes = service.generateSyntheticChanges(baseRates, 100);
    const result = service.computePCAFactors(changes);
    const dv01 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const attr = service.attributeDV01(dv01, result.factors);
    expect(attr).toHaveProperty('level');
    expect(attr).toHaveProperty('slope');
    expect(attr).toHaveProperty('curvature');
  });

  it('generateSyntheticChanges returns the requested shape', () => {
    const changes = service.generateSyntheticChanges([0.04, 0.042, 0.044], 52);
    expect(changes).toHaveLength(52);
    expect(changes[0]).toHaveLength(3);
  });
});
