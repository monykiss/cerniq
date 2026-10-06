import { AssetEWSService } from './asset-ews.service';

describe('AssetEWSService', () => {
  let service: AssetEWSService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      loanSegment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AssetEWSService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── D1: empty institution → data_unavailable, never a fabricated score ──
  it('returns a DATA_UNAVAILABLE shell with a CRITICAL gap when there is no portfolio', async () => {
    const result = await service.computeEWS('inst-1');

    expect(result.status).toBe('data_unavailable');
    expect(result.alertLevel).toBe('DATA_UNAVAILABLE');
    expect(result.compositeScore).toBeNull();
    expect(result.anomalyScore).toBeNull();
    expect(result.indicators).toHaveLength(12);
    expect(result.indicators.every((i) => i.value === null)).toBe(true);
    expect(
      result.gaps?.some(
        (g) => g.reason === 'EMPTY_BALANCE_SHEET' && g.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  // ── D1: balance sheet present but no loss history → still won't grade ──
  it('refuses to grade (data_unavailable) when loan segments / loss history are missing', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'commercial_loans', balance: 5000 },
    ]);
    prisma.loanSegment.findMany.mockResolvedValue([]); // no loss history

    const result = await service.computeEWS('inst-no-loss');
    expect(result.status).toBe('data_unavailable');
    expect(result.compositeScore).toBeNull();
    expect(
      result.gaps?.some((g) => g.reason === 'EWS_INPUTS_INSUFFICIENT'),
    ).toBe(true);
  });

  it('keeps the indicator catalogue stable (weights sum to 100) even when unavailable', async () => {
    const result = await service.computeEWS('inst-1');
    const totalWeight = result.indicators.reduce((s, i) => s + i.weight, 0);
    expect(totalWeight).toBe(100);
  });

  // ── ok path: derived indicators measured, unwired ones disclosed ──
  it('scores over measured indicators and discloses unwired ones with WARNING gaps', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'commercial_loans', balance: 5000 },
      { category: 'asset', subcategory: 'auto_loans', balance: 3000 },
      { category: 'asset', subcategory: 'cash', balance: 1000 },
      { category: 'asset', subcategory: 'securities', balance: 2000 },
    ]);
    prisma.loanSegment.findMany.mockResolvedValue([
      { balance: 5000, historicalLossRate: 0.03 },
      { balance: 3000, historicalLossRate: 0.02 },
    ]);

    const result = await service.computeEWS('inst-with-data');

    expect(result.status).toBe('ok');
    expect(result.compositeScore).not.toBeNull();
    expect(result.compositeScore!).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore!).toBeLessThanOrEqual(100);
    expect(result.indicators).toHaveLength(12);

    // The 5 derived indicators carry numeric values; the 7 unwired are null.
    const measured = result.indicators.filter((i) => i.value !== null);
    expect(measured.map((i) => i.id).sort()).toEqual(
      [
        'chargeoff_rate',
        'classified_ratio',
        'delinquency_30d',
        'delinquency_90d',
        'npl_ratio',
      ].sort(),
    );
    const unwired = result.indicators.filter((i) => i.value === null);
    expect(unwired).toHaveLength(7);
    unwired.forEach((i) => expect(i.alertLevel).toBe('data_unavailable'));

    // Every unwired indicator is disclosed via an INDICATOR_NOT_WIRED gap.
    const notWired = (result.gaps ?? []).filter(
      (g) => g.reason === 'INDICATOR_NOT_WIRED',
    );
    expect(notWired).toHaveLength(7);
  });

  it('produces RED-leaning indicators and a lower composite with high loss rates', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'commercial_loans', balance: 10000 },
    ]);
    prisma.loanSegment.findMany.mockResolvedValue([
      { balance: 10000, historicalLossRate: 0.08 }, // very high loss rate
    ]);

    const result = await service.computeEWS('inst-high-loss');
    expect(result.status).toBe('ok');
    const redIndicators = result.indicators.filter(
      (i) => i.alertLevel === 'red',
    );
    expect(redIndicators.length).toBeGreaterThan(0);
    expect(result.anomalyScore).not.toBeNull();
    expect(result.anomalyScore!).toBeGreaterThan(0.3);
  });

  // ── peer alert is honest about the unwired peer benchmark ──
  it('reports the peer comparison as unavailable while the peer feed is unwired', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', subcategory: 'commercial_loans', balance: 10000 },
    ]);
    prisma.loanSegment.findMany.mockResolvedValue([
      { balance: 10000, historicalLossRate: 0.03 },
    ]);

    const result = await service.computeEWS('inst-peer');
    expect(result.peerAlert.toLowerCase()).toContain('unavailable');
    expect(result.peerAlertEs.toLowerCase()).toContain('no disponible');
    const peer = result.indicators.find((i) => i.id === 'peer_delinquency_gap');
    expect(peer!.value).toBeNull();
  });

  it('emits bilingual peer alert strings', async () => {
    const result = await service.computeEWS('inst-1');
    expect(typeof result.peerAlert).toBe('string');
    expect(typeof result.peerAlertEs).toBe('string');
    expect(result.peerAlert.length).toBeGreaterThan(0);
    expect(result.peerAlertEs.length).toBeGreaterThan(0);
  });
});
