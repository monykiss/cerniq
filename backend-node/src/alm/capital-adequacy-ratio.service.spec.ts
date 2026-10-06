import { CapitalAdequacyRatioService } from './capital-adequacy-ratio.service';

describe('CapitalAdequacyRatioService', () => {
  const svc = new CapitalAdequacyRatioService();

  const baseParams = {
    cet1Capital: 80_000_000,
    additionalTier1: 10_000_000,
    tier2Capital: 15_000_000,
    riskWeightedAssets: 500_000_000,
    totalAssets: 700_000_000,
  };

  it('should return correct output shape', () => {
    const result = svc.calculate(baseParams);
    expect(result).toHaveProperty('cet1Ratio');
    expect(result).toHaveProperty('tier1Ratio');
    expect(result).toHaveProperty('totalCapitalRatio');
    expect(result).toHaveProperty('leverageRatio');
    expect(result).toHaveProperty('buffers');
    expect(result).toHaveProperty('compliance');
    expect(result).toHaveProperty('stressCapital');
    expect(result.stressCapital.length).toBe(5);
  });

  it('should compute CET1/Tier1/Total ratios correctly', () => {
    const result = svc.calculate(baseParams);
    // CET1 = 80M / 500M * 100 = 16%
    expect(result.cet1Ratio).toBeCloseTo(16, 0);
    // Tier1 = (80M + 10M) / 500M * 100 = 18%
    expect(result.tier1Ratio).toBeCloseTo(18, 0);
    // Total = (80M + 10M + 15M) / 500M * 100 = 21%
    expect(result.totalCapitalRatio).toBeCloseTo(21, 0);
  });

  it('should compute leverage ratio correctly', () => {
    const result = svc.calculate(baseParams);
    // leverage = tier1 / totalAssets * 100 = 90M / 700M * 100 = 12.86%
    expect(result.leverageRatio).toBeCloseTo(12.86, 1);
  });

  it('should mark all compliant for well-capitalized institution', () => {
    const result = svc.calculate(baseParams);
    expect(result.compliance.cet1).toBe(true);
    expect(result.compliance.tier1).toBe(true);
    expect(result.compliance.total).toBe(true);
    expect(result.compliance.leverage).toBe(true);
  });

  it('should mark non-compliant when ratios are below minimums', () => {
    const result = svc.calculate({
      ...baseParams,
      cet1Capital: 20_000_000,
      additionalTier1: 2_000_000,
      tier2Capital: 3_000_000,
    });
    // CET1 = 20M / 500M = 4% < 7%
    expect(result.compliance.cet1).toBe(false);
    // Tier1 = 22M / 500M = 4.4% < 8.5%
    expect(result.compliance.tier1).toBe(false);
  });

  it('should compute conservation buffer correctly', () => {
    const result = svc.calculate(baseParams);
    // buffer = CET1 ratio - 4.5% = 16 - 4.5 = 11.5
    expect(result.buffers.conservationBuffer).toBeCloseTo(11.5, 0);
  });
});
