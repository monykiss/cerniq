import { NetworkIntelligenceService } from './network-intelligence.service';

describe('NetworkIntelligenceService', () => {
  const mk = (institutions: unknown[]) =>
    new NetworkIntelligenceService({
      institution: { findMany: jest.fn().mockResolvedValue(institutions) },
    } as any);

  it('should be defined', () => {
    expect(mk([])).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the 94-institution demo) ──

  it('returns a data_unavailable shell with a CRITICAL gap when no institutions exist', async () => {
    const result = await mk([]).getNetworkOverview();

    expect(result.status).toBe('data_unavailable');
    expect(result.aggregates.totalInstitutions).toBe(0);
    expect(result.aggregates.systemicRiskScore).toBeNull();
    expect(result.aggregates.avgNWR).toBeNull();
    expect(result.aggregates.riskDistribution).toBeNull();
    expect(result.institutions).toEqual([]);
    expect(result.outliers).toEqual([]);
    expect(result.contagionRisks).toEqual([]);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('MISSING_INSTITUTION');
    expect(critical!.field).toBe('networkIntelligence.institutions');
  });

  // ── D1: real institutions — honest aggregates ──────────────────

  it('computes network overview from real institutions with status ok', async () => {
    const result = await mk([
      {
        id: 'i1',
        name: 'CU Alpha',
        totalAssets: 300,
        type: 'cooperativa',
        balanceSheetItems: [
          { category: 'asset', balance: 300 },
          { category: 'liability', balance: 270 },
        ],
      },
      {
        id: 'i2',
        name: 'CU Beta',
        totalAssets: 200,
        type: 'cooperativa',
        balanceSheetItems: [
          { category: 'asset', balance: 200 },
          { category: 'liability', balance: 185 },
        ],
      },
    ]).getNetworkOverview();

    expect(result.status).toBe('ok');
    expect(result.aggregates.totalInstitutions).toBe(2);
    expect(result.aggregates.totalSystemAssets).toBe(500);
    expect(result.institutions).toHaveLength(2);
    expect(result.institutions[0].name).toBe('CU Alpha');
    // avgNWR is computable from real balance sheets: (10% + 7.5%) / 2 = 8.75,
    // rounded to one decimal (8.8) by the service.
    expect(result.aggregates.avgNWR).toBeCloseTo(8.8, 1);
  });

  it('reports the not-yet-wired network indicators as null with a disclosed gap', async () => {
    const result = await mk([
      {
        id: 'i1',
        name: 'CU Alpha',
        totalAssets: 300,
        type: 'cooperativa',
        balanceSheetItems: [
          { category: 'asset', balance: 300 },
          { category: 'liability', balance: 270 },
        ],
      },
    ]).getNetworkOverview();

    // CAMEL/NIM/LCR averages, systemic-risk score and the rating distribution
    // need per-institution scoring that is not wired — null, not fabricated.
    expect(result.aggregates.avgCAMEL).toBeNull();
    expect(result.aggregates.avgNIM).toBeNull();
    expect(result.aggregates.avgLCR).toBeNull();
    expect(result.aggregates.systemicRiskScore).toBeNull();
    expect(result.aggregates.riskDistribution).toBeNull();
    expect(result.contagionRisks).toEqual([]);

    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.reason).toBe('INDICATOR_NOT_WIRED');
  });

  it('classifies institution risk level from real NWR', async () => {
    const result = await mk([
      {
        id: 'i1',
        name: 'Well-Cap',
        totalAssets: 100,
        type: 'cu',
        balanceSheetItems: [
          { category: 'asset', balance: 100 },
          { category: 'liability', balance: 85 }, // NWR = 15%
        ],
      },
      {
        id: 'i2',
        name: 'Low-Cap',
        totalAssets: 100,
        type: 'cu',
        balanceSheetItems: [
          { category: 'asset', balance: 100 },
          { category: 'liability', balance: 96 }, // NWR = 4%
        ],
      },
    ]).getNetworkOverview();

    const wellCap = result.institutions.find((i) => i.name === 'Well-Cap');
    const lowCap = result.institutions.find((i) => i.name === 'Low-Cap');
    expect(wellCap!.riskLevel).toBe('low');
    expect(lowCap!.riskLevel).toBe('high');
    // camelComposite stays null (CAMEL not computed per institution — honest)
    expect(wellCap!.camelComposite).toBeNull();
  });
});
