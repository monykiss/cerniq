import { WrongWayRiskService } from './wrong-way-risk.service';

describe('WrongWayRiskService', () => {
  let service: WrongWayRiskService;

  const realSegments = [
    {
      segmentName: 'CRE',
      historicalLossRate: 0.02,
      lgd: 0.4,
      balance: 100,
      weightedAvgMaturity: 5,
    },
    {
      segmentName: 'Consumer',
      historicalLossRate: 0.03,
      lgd: 0.6,
      balance: 50,
      weightedAvgMaturity: 3,
    },
  ];

  const mk = (segments: unknown[]) =>
    new WrongWayRiskService({
      loanSegment: { findMany: jest.fn().mockResolvedValue(segments) },
    } as any);

  // ── D1: honest empty-data shell (never the $3.8M demo) ─────────

  it('returns a data_unavailable shell with a CRITICAL gap when no loan segments exist', async () => {
    service = mk([]);

    const result = await service.computeWWR('inst-1');

    expect(result.status).toBe('data_unavailable');
    expect(result.naiveCVA).toBeNull();
    expect(result.adjustedCVA).toBeNull();
    expect(result.wwrPremium).toBeNull();
    expect(result.wwrMultiplier).toBeNull();
    expect(result.bySegment).toEqual([]);
    expect(result.narrativeEs).toBeNull();
    expect(result.narrativeEn).toBeNull();

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('NO_LOAN_SEGMENTS');
    expect(critical!.field).toBe('wrongWayRisk.loanSegments');
  });

  // ── D1: real-data computation (not the unconditional demo) ─────

  it('computes WWR-adjusted CVA from real loan segments', async () => {
    service = mk(realSegments);

    const result = await service.computeWWR('inst-1', 0.3);

    expect(result.status).toBe('ok');
    expect(result.adjustedCVA).toBeGreaterThan(result.naiveCVA!);
    expect(result.bySegment).toHaveLength(2);
    expect(result.bySegment.map((s) => s.segment)).toEqual(['CRE', 'Consumer']);
    expect(result.gaps).toBeUndefined();
  });

  it('WWR premium = adjustedCVA - naiveCVA and multiplier > 1 on real data', async () => {
    service = mk(realSegments);

    const result = await service.computeWWR('inst-1');

    expect(result.wwrPremium).toBeCloseTo(
      result.adjustedCVA! - result.naiveCVA!,
      1,
    );
    expect(result.wwrMultiplier).toBeGreaterThan(1);
  });

  it('produces bilingual narratives on real data', async () => {
    service = mk(realSegments);

    const result = await service.computeWWR('inst-1');

    expect(result.narrativeEn).toBeTruthy();
    expect(result.narrativeEs).toBeTruthy();
  });
});
