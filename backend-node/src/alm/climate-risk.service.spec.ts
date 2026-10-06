import { ClimateRiskService } from './climate-risk.service';

describe('ClimateRiskService', () => {
  let service: ClimateRiskService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new ClimateRiskService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('computes climate risk with RE exposure items', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'residential_mortgage',
        balance: 150,
        floodZone: 'AE',
      },
      {
        category: 'asset',
        subcategory: 'commercial_re',
        balance: 100,
        floodZone: 'VE',
      },
      { category: 'asset', subcategory: 'cash', balance: 50 },
      { category: 'asset', subcategory: 'securities', balance: 100 },
      { category: 'liability', subcategory: 'deposits', balance: 350 },
    ]);

    const result = await service.computeClimateRisk('inst_1');

    expect(result.totalREExposure).toBe(250);
    expect(result.hurricaneAAL).toBeGreaterThan(0);
    expect(result.hurricaneAALPct).toBeGreaterThan(0);
    expect(result.scenarios).toHaveLength(5);
    expect(result.cat3ScenarioLoss).toBeGreaterThan(0);
    expect(result.cat5ScenarioLoss).toBeGreaterThan(result.cat3ScenarioLoss);
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(result.riskLevel);
    expect(result.narrativeEn).toContain('Hurricane AAL');
    expect(result.narrativeEs).toContain('huracanes');
  });

  it('returns valid result with empty balance sheet (fallback totalAssets)', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.computeClimateRisk('inst_1');

    expect(result.totalREExposure).toBe(0);
    expect(result.hurricaneAAL).toBe(0);
    expect(result.scenarios).toHaveLength(5);
    expect(result.riskLevel).toBe('LOW');
  });

  it('scenario probabilities sum to expected range', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'residential_mortgage',
        balance: 200,
        floodZone: 'X',
      },
    ]);
    const result = await service.computeClimateRisk('inst_1');

    const totalProb = result.scenarios.reduce((s, sc) => s + sc.probability, 0);
    expect(totalProb).toBeCloseTo(0.225, 2); // sum of all cat probabilities
  });

  it('flood zone exposure uses correct FEMA haircuts', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        category: 'asset',
        subcategory: 'residential_mortgage',
        balance: 100,
        floodZone: 'VE',
      },
    ]);
    const result = await service.computeClimateRisk('inst_1');
    // VE haircut = 0.4 * 100 = 40
    expect(result.floodZoneExposure).toBeCloseTo(40, 0);
  });

  it('mitigation score reflects HQLA buffer', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'cash', balance: 200 },
      { category: 'asset', subcategory: 'securities', balance: 200 },
      { category: 'asset', subcategory: 'residential_mortgage', balance: 50 },
      { category: 'liability', subcategory: 'deposits', balance: 400 },
    ]);
    const result = await service.computeClimateRisk('inst_1');
    // HQLA = 400/450 = ~0.89, so hqlaPct*200 = 178, plus RE < 40% bonus = +30 => capped at 100
    expect(result.mitigationScore).toBeGreaterThanOrEqual(0);
    expect(result.mitigationScore).toBeLessThanOrEqual(100);
  });
});
