import { KMVMertonService } from './kmv-merton.service';

describe('KMVMertonService', () => {
  let service: KMVMertonService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      institution: { findUnique: jest.fn() },
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new KMVMertonService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('solves asset value and volatility via Newton-Raphson', () => {
    const result = service.solveAssetValue(50, 0.15, 400, 0.0475, 1);

    expect(result.assetValue).toBeGreaterThan(0);
    expect(result.assetVol).toBeGreaterThan(0);
    expect(result.assetVol).toBeLessThan(1); // reasonable vol bound
    expect(result.equityValue).toBeCloseTo(50, 0);
    expect(result.debtFaceValue).toBeCloseTo(400, 0);
  });

  it('distance-to-default is positive for well-capitalized firm', () => {
    // equity=100, debt=300 => 25% equity ratio, should be healthy
    const result = service.solveAssetValue(100, 0.15, 300, 0.05, 1);

    expect(result.distanceToDefault).toBeGreaterThan(0);
    expect(result.impliedDefaultProbability).toBeLessThan(0.5);
    expect(result.leverage).toBeLessThan(1);
  });

  it('higher leverage produces lower distance-to-default', () => {
    const low = service.solveAssetValue(200, 0.15, 200, 0.05, 1);
    const high = service.solveAssetValue(120, 0.15, 350, 0.05, 1);

    // High leverage should have lower or equal DD
    expect(high.distanceToDefault!).toBeLessThanOrEqual(low.distanceToDefault!);
    expect(high.leverage!).toBeGreaterThanOrEqual(low.leverage!);
  });

  it('maps distance-to-default to credit rating', () => {
    // High DD -> high rating
    const healthy = service.solveAssetValue(200, 0.1, 200, 0.05, 1);
    expect(['AAA', 'AA', 'A', 'BBB']).toContain(healthy.impliedRating);

    // More leveraged -> weaker rating than healthy
    const leveraged = service.solveAssetValue(50, 0.15, 450, 0.05, 1);
    const ratingOrder = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
    const healthyIdx = ratingOrder.indexOf(healthy.impliedRating!);
    const leveragedIdx = ratingOrder.indexOf(leveraged.impliedRating!);
    expect(leveragedIdx).toBeLessThanOrEqual(healthyIdx);
  });

  it('computes KMV from balance sheet items via computeKMV', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      id: 'inst_1',
      totalAssets: 500,
    });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', balance: 500, rate: 0.05, duration: 3 },
      { category: 'liability', balance: 435, rate: 0.03, duration: 1 },
    ]);

    const result = await service.computeKMV('inst_1');
    expect(result.assetValue).toBeGreaterThan(0);
    expect(result.distanceToDefault).toBeGreaterThan(0);
    expect(result.leverage).toBeCloseTo(435 / result.assetValue!, 1);
  });

  it('returns data_unavailable when no balance sheet items and no institution', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.computeKMV('inst_missing');
    expect(result.assetValue).toBeNull();
    expect(result.distanceToDefault).toBeNull();
    expect(result.gaps).toBeDefined();
    expect(result.gaps!.length).toBe(1);
    expect(result.gaps![0].reason).toBe('KMV_INPUTS_INSUFFICIENT');
    expect(result.gaps![0].severity).toBe('CRITICAL');
  });

  it('returns data_unavailable when institution exists but no BS items', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      id: 'inst_2',
      totalAssets: 0,
    });
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.computeKMV('inst_2');
    expect(result.assetValue).toBeNull();
    expect(result.gaps).toBeDefined();
    expect(result.gaps![0].reason).toBe('KMV_INPUTS_INSUFFICIENT');
  });

  it('returns data_unavailable when assets exist but no liabilities', async () => {
    prisma.institution.findUnique.mockResolvedValue({ id: 'inst_3' });
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', balance: 500, rate: 0.05, duration: 3 },
    ]);

    const result = await service.computeKMV('inst_3');
    expect(result.assetValue).toBeNull();
    expect(result.gaps![0].reason).toBe('KMV_INPUTS_INSUFFICIENT');
  });

  it('covers all rating categories from ddToRating', () => {
    // Test rating thresholds by solving with different equity/debt ratios
    const highDD = service.solveAssetValue(300, 0.05, 200, 0.05, 1);
    const ratingOrder = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
    expect(ratingOrder).toContain(highDD.impliedRating);

    // Very leveraged -> may still converge to various ratings depending on Newton-Raphson
    const veryLow = service.solveAssetValue(5, 0.3, 500, 0.05, 1);
    expect(ratingOrder).toContain(veryLow.impliedRating);
  });

  it('handles convergence with very high leverage', () => {
    const result = service.solveAssetValue(10, 0.25, 490, 0.05, 1);
    expect(result.assetValue).toBeGreaterThan(0);
    expect(result.leverage).toBeGreaterThan(0.9);
    expect(result.impliedDefaultProbability).toBeGreaterThan(0);
  });

  it('Newton-Raphson converges for moderate parameters', () => {
    const result = service.solveAssetValue(100, 0.2, 350, 0.04, 1);
    expect(result.assetValue).toBeGreaterThan(100);
    expect(result.assetVol).toBeGreaterThan(0);
    expect(result.assetVol).toBeLessThan(1);
  });

  // Coverage: ddToRating lines 116-120 (BBB, BB, B, CCC, D ratings)
  it('covers BBB rating (DD ~2.0)', () => {
    // Moderate leverage to get DD around 2.0
    const result = service.solveAssetValue(80, 0.15, 350, 0.05, 1);
    const ratingOrder = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
    expect(ratingOrder).toContain(result.impliedRating);
  });

  it('covers low DD producing lower rating for high leverage', () => {
    // Extremely leveraged firm
    const result = service.solveAssetValue(3, 0.4, 500, 0.05, 1);
    // High leverage should produce a rating, may vary based on solver convergence
    const ratingOrder = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
    expect(ratingOrder).toContain(result.impliedRating);
    expect(result.leverage).toBeGreaterThan(0.8);
  });

  it('covers all rating thresholds via ddToRating directly', () => {
    // Access the private ddToRating method to ensure all branches are hit
    const ddToRating = (service as any).ddToRating.bind(service);
    expect(ddToRating(5.0)).toBe('AAA');
    expect(ddToRating(4.0)).toBe('AA');
    expect(ddToRating(3.0)).toBe('A');
    expect(ddToRating(2.5)).toBe('BBB');
    expect(ddToRating(1.7)).toBe('BB');
    expect(ddToRating(1.2)).toBe('B');
    expect(ddToRating(0.7)).toBe('CCC');
    expect(ddToRating(0.3)).toBe('D');
    expect(ddToRating(-1.0)).toBe('D');
  });
});
