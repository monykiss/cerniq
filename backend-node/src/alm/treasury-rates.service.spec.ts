import { TreasuryRatesService } from './treasury-rates.service';

describe('TreasuryRatesService', () => {
  let service: TreasuryRatesService;

  beforeEach(() => {
    service = new TreasuryRatesService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getApproximation returns valid snapshot shape with all tenor keys', async () => {
    // No FRED_API_KEY set, so falls back to approximation
    const snapshot = await service.getLatestSnapshot();
    expect(snapshot).toHaveProperty('capturedAt');
    expect(snapshot).toHaveProperty('fedFunds');
    expect(snapshot).toHaveProperty('sofr');
    expect(snapshot).toHaveProperty('treasury3M');
    expect(snapshot).toHaveProperty('treasury1Y');
    expect(snapshot).toHaveProperty('treasury2Y');
    expect(snapshot).toHaveProperty('treasury5Y');
    expect(snapshot).toHaveProperty('treasury10Y');
    expect(snapshot).toHaveProperty('treasury30Y');
    expect(snapshot.source).toBe('approximation');
    expect(snapshot.prMuniSpread).toBe(0.0185);
  });

  it('getYieldCurvePoints returns 6 points with ascending tenors', async () => {
    const points = await service.getYieldCurvePoints();
    expect(points).toHaveLength(6);
    expect(points[0].tenor).toBe(0.25);
    expect(points[5].tenor).toBe(30);
    for (const p of points) {
      expect(p.rate).toBeGreaterThan(0);
      expect(p.rate).toBeLessThan(0.2);
    }
  });

  it('detectRateMoves emits alerts when delta >= 5 bps', () => {
    const previous = {
      capturedAt: '2026-03-01T00:00:00Z',
      fedFunds: 0.0475,
      sofr: 0.047,
      treasury3M: 0.048,
      treasury1Y: 0.044,
      treasury2Y: 0.042,
      treasury5Y: 0.0405,
      treasury10Y: 0.042,
      treasury30Y: 0.0465,
      prMuniSpread: 0.0185,
      source: 'approximation',
    };
    const current = {
      ...previous,
      capturedAt: '2026-03-02T00:00:00Z',
      fedFunds: 0.048, // +5 bps
      treasury10Y: 0.043, // +10 bps
    };

    const alerts = service.detectRateMoves(previous, current);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    const fedAlert = alerts.find((a) => a.rate === 'fedFunds');
    expect(fedAlert).toBeDefined();
    expect(fedAlert!.direction).toBe('UP');
    expect(fedAlert!.deltaBps).toBe(5);

    const t10Alert = alerts.find((a) => a.rate === 'treasury10Y');
    expect(t10Alert).toBeDefined();
    expect(t10Alert!.deltaBps).toBe(10);
  });

  it('detectRateMoves returns empty array when moves < 5 bps', () => {
    const base = {
      capturedAt: '2026-03-01T00:00:00Z',
      fedFunds: 0.0475,
      sofr: 0.047,
      treasury3M: 0.048,
      treasury1Y: 0.044,
      treasury2Y: 0.042,
      treasury5Y: 0.0405,
      treasury10Y: 0.042,
      treasury30Y: 0.0465,
      prMuniSpread: 0.0185,
      source: 'approximation',
    };
    const alerts = service.detectRateMoves(base, {
      ...base,
      fedFunds: 0.04753,
    });
    expect(alerts).toHaveLength(0);
  });

  it('caches snapshot on repeated calls', async () => {
    const snap1 = await service.getLatestSnapshot();
    const snap2 = await service.getLatestSnapshot();
    expect(snap1.capturedAt).toBe(snap2.capturedAt);
  });

  it('detectRateMoves returns DOWN direction for negative delta', () => {
    const previous = {
      capturedAt: '2026-03-01T00:00:00Z',
      fedFunds: 0.0475,
      sofr: 0.047,
      treasury3M: 0.048,
      treasury1Y: 0.044,
      treasury2Y: 0.042,
      treasury5Y: 0.0405,
      treasury10Y: 0.042,
      treasury30Y: 0.0465,
      prMuniSpread: 0.0185,
      source: 'approximation',
    };
    const current = {
      ...previous,
      capturedAt: '2026-03-02T00:00:00Z',
      sofr: 0.0455, // -15 bps
    };
    const alerts = service.detectRateMoves(previous, current);
    const sofrAlert = alerts.find((a) => a.rate === 'sofr');
    expect(sofrAlert).toBeDefined();
    expect(sofrAlert!.direction).toBe('DOWN');
    expect(sofrAlert!.deltaBps).toBeLessThan(0);
  });

  it('detectRateMoves skips non-numeric values gracefully', () => {
    const previous = {
      capturedAt: '2026-03-01T00:00:00Z',
      fedFunds: 0.0475,
      sofr: 0.047,
      treasury3M: 0.048,
      treasury1Y: 0.044,
      treasury2Y: 0.042,
      treasury5Y: 0.0405,
      treasury10Y: 0.042,
      treasury30Y: 0.0465,
      prMuniSpread: 0.0185,
      source: 'approximation',
    };
    // capturedAt and source are non-numeric, but they are not in the monitored keys
    const alerts = service.detectRateMoves(previous, { ...previous });
    expect(alerts).toHaveLength(0);
  });

  it('getLatestSnapshot uses FRED API when FRED_API_KEY is set', async () => {
    process.env.FRED_API_KEY = 'test-key';
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ observations: [{ value: '4.75' }] }),
    });
    (global as any).fetch = mockFetch;

    const snapshot = await service.getLatestSnapshot();
    expect(snapshot.source).toBe('FRED');
    expect(mockFetch).toHaveBeenCalled();

    delete process.env.FRED_API_KEY;
    delete (global as any).fetch;
  });

  it('falls back to approximation when FRED_API_KEY is not set', async () => {
    delete process.env.FRED_API_KEY;
    const freshService = new TreasuryRatesService();
    const snapshot = await freshService.getLatestSnapshot();
    expect(snapshot.source).toBe('approximation');
    expect(snapshot.fedFunds).toBe(0.0475);
  });

  it('falls back to approximation when FRED fetch throws', async () => {
    process.env.FRED_API_KEY = 'test-key';
    const freshService = new TreasuryRatesService();
    // Override the private fetchFromFRED method to throw
    (freshService as any).fetchFromFRED = jest
      .fn()
      .mockRejectedValue(new Error('FRED down'));
    const snapshot = await freshService.getLatestSnapshot();
    expect(snapshot.source).toBe('approximation');
    delete process.env.FRED_API_KEY;
  });
});
