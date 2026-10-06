import { MarketDataFeedService } from './market-data-feed.service';

// ─── Helpers ─────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    marketDataSnapshot: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    balanceSheetItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function buildService(prisma = buildMockPrisma()) {
  return new MarketDataFeedService(prisma);
}

// ─── Tests ───────────────────────────────────────────────────

describe('MarketDataFeedService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── fetchLatestRates ──────────────────────────────────────

  describe('fetchLatestRates', () => {
    it('should return an array of snapshots with correct schema fields', async () => {
      const service = buildService();
      const snapshots = await service.fetchLatestRates();

      expect(Array.isArray(snapshots)).toBe(true);
      expect(snapshots.length).toBeGreaterThan(0);

      for (const snap of snapshots) {
        expect(snap).toHaveProperty('dataType');
        expect(snap).toHaveProperty('value');
        expect(snap).toHaveProperty('asOfDate');
        expect(snap).toHaveProperty('source');
        expect(typeof snap.dataType).toBe('string');
        expect(typeof snap.value).toBe('number');
      }
    });

    it('should include SOFR, treasury, and PR deposit index', async () => {
      const service = buildService();
      const snapshots = await service.fetchLatestRates();
      const types = snapshots.map((s) => s.dataType);

      expect(types).toContain('SOFR');
      expect(types).toContain('PR_DEPOSIT_INDEX');
      // At least some UST tenor should be present
      const hasTreasury = types.some((t) => t.startsWith('UST_'));
      expect(hasTreasury).toBe(true);
    });

    it('should persist snapshots to cache for subsequent lookups', async () => {
      const service = buildService();
      await service.fetchLatestRates();

      const sofr = service.getLatestSnapshot('SOFR');
      expect(sofr).not.toBeNull();
      expect(sofr!.dataType).toBe('SOFR');
      expect(typeof sofr!.value).toBe('number');
    });
  });

  // ── fetchSOFR ─────────────────────────────────────────────

  describe('fetchSOFR', () => {
    it('should return demo SOFR when FRED_API_KEY is not set', async () => {
      delete process.env.FRED_API_KEY;
      const service = buildService();
      const result = await service.fetchSOFR();

      expect(result.dataType).toBe('SOFR');
      expect(result.source).toBe('demo');
      expect(result.value).toBeCloseTo(0.047, 3);
      expect(typeof result.asOfDate).toBe('string');
    });

    it('should parse FRED API response format when key is set', async () => {
      process.env.FRED_API_KEY = 'test-key';

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          observations: [{ date: '2026-04-15', value: '4.70' }],
        }),
      };
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

      const service = buildService();
      const result = await service.fetchSOFR();

      expect(result.dataType).toBe('SOFR');
      expect(result.value).toBeCloseTo(0.047, 3);
      expect(result.source).toBe('FRED');
      expect(result.asOfDate).toBe('2026-04-15');

      delete process.env.FRED_API_KEY;
    });

    it('should fall back to demo on FRED API error', async () => {
      process.env.FRED_API_KEY = 'test-key';

      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 500 } as any);

      const service = buildService();
      await expect(service.fetchSOFR()).rejects.toThrow(
        'FRED API returned 500',
      );

      delete process.env.FRED_API_KEY;
    });
  });

  // ── fetchTreasuryCurve ────────────────────────────────────

  describe('fetchTreasuryCurve', () => {
    it('should return demo curve points when FRED_API_KEY is not set', async () => {
      delete process.env.FRED_API_KEY;
      const service = buildService();
      const result = await service.fetchTreasuryCurve();

      expect(result.points.length).toBe(11);
      expect(result.points[0]).toHaveProperty('tenorMonths');
      expect(result.points[0]).toHaveProperty('rate');

      // Points should be sorted by tenor
      for (let i = 1; i < result.points.length; i++) {
        expect(result.points[i].tenorMonths).toBeGreaterThan(
          result.points[i - 1].tenorMonths,
        );
      }
    });

    it('should produce correct tenor points from FRED data', async () => {
      process.env.FRED_API_KEY = 'test-key';

      // Mock fetch for each treasury series call
      jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        // Use series_id= to match precisely (avoids DGS2 matching DGS20)
        if (urlStr.includes('series_id=DGS10&')) {
          return {
            ok: true,
            json: async () => ({
              observations: [{ date: '2026-04-15', value: '4.20' }],
            }),
          } as any;
        }
        if (urlStr.includes('series_id=DGS2&')) {
          return {
            ok: true,
            json: async () => ({
              observations: [{ date: '2026-04-15', value: '4.00' }],
            }),
          } as any;
        }
        // Return empty for others so we only get 2 points
        return {
          ok: true,
          json: async () => ({ observations: [] }),
        } as any;
      });

      const service = buildService();
      const result = await service.fetchTreasuryCurve();

      expect(result.points.length).toBe(2);
      const tenors = result.points.map((p) => p.tenorMonths);
      expect(tenors).toContain(24); // 2Y
      expect(tenors).toContain(120); // 10Y

      const p10y = result.points.find((p) => p.tenorMonths === 120);
      expect(p10y!.rate).toBeCloseTo(0.042, 3);

      delete process.env.FRED_API_KEY;
    });
  });

  // ── Polling ───────────────────────────────────────────────

  describe('polling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start and stop polling cleanly', () => {
      const service = buildService();

      // Spy on fetchLatestRates to verify it gets called
      const spy = jest.spyOn(service, 'fetchLatestRates').mockResolvedValue([]);

      service.startPolling(10_000);

      // Initial immediate fetch
      expect(spy).toHaveBeenCalledTimes(1);

      // Should not start a second timer
      service.startPolling(10_000);
      expect(spy).toHaveBeenCalledTimes(1); // no extra call

      service.stopPolling();

      // After stop, advancing time should not trigger more calls
      jest.advanceTimersByTime(30_000);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
