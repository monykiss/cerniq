import { NCUADataPullService } from './ncua-data-pull.service';

describe('NCUADataPullService', () => {
  let service: NCUADataPullService;

  beforeEach(() => {
    service = new NCUADataPullService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('pullByCharterNumber rejects invalid charter numbers', async () => {
    await expect(service.pullByCharterNumber('abc')).rejects.toThrow(
      'Charter number must be 4-6 digits',
    );
    await expect(service.pullByCharterNumber('123')).rejects.toThrow();
    await expect(service.pullByCharterNumber('1234567')).rejects.toThrow();
  });

  it('pullByCharterNumber returns data for valid charter', async () => {
    const result = await service.pullByCharterNumber('12345');
    expect(result.charterNumber).toBe('12345');
    expect(result.source).toBe('ncua_5300');
    expect(result.totalAssets).toBeGreaterThan(0);
    expect(result.netWorthRatio).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.loanSegments.length).toBeGreaterThan(0);
  });

  it('pullByCharterNumber returns deterministic data for same charter', async () => {
    const r1 = await service.pullByCharterNumber('54321');
    const r2 = await service.pullByCharterNumber('54321');
    expect(r1.totalAssets).toBe(r2.totalAssets);
    expect(r1.institutionName).toBe(r2.institutionName);
  });

  it('pullByCharterNumber serves from cache on second call', async () => {
    await service.pullByCharterNumber('11111');
    const r2 = await service.pullByCharterNumber('11111');
    expect(r2.charterNumber).toBe('11111');
  });

  it('mapToBalanceSheetItems returns the items array', async () => {
    const data = await service.pullByCharterNumber('22222');
    const items = service.mapToBalanceSheetItems(data);
    expect(items).toBe(data.items);
    expect(items.length).toBeGreaterThan(0);
  });

  it('mapToLoanSegments returns loan segments with loss rates', async () => {
    const data = await service.pullByCharterNumber('33333');
    const segments = service.mapToLoanSegments(data);
    expect(segments).toBe(data.loanSegments);
    segments.forEach((seg) => {
      expect(seg.historicalLossRate).toBeGreaterThanOrEqual(0);
      expect(seg.balance).toBeGreaterThan(0);
    });
  });
});
