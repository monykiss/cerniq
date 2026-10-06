import { NcuaApiService } from './ncua-api.service';

describe('NcuaApiService', () => {
  let svc: NcuaApiService;
  const realFetch = global.fetch;

  beforeEach(() => {
    svc = new NcuaApiService();
    delete process.env.NCUA_DEMO_FALLBACK;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.NCUA_DEMO_FALLBACK;
    jest.restoreAllMocks();
  });

  function mockFetch(impl: (...args: any[]) => any): void {
    global.fetch = jest.fn(impl) as any;
  }

  // ─── Honest failure: NEVER fabricate on API error (default) ──
  describe('NCUA API failure, default (no demo fallback)', () => {
    beforeEach(() => {
      mockFetch(async () => {
        throw new Error('NCUA network down');
      });
    });

    it('fetchCreditUnion throws — does not import a phantom credit union', async () => {
      await expect(svc.fetchCreditUnion('12345')).rejects.toThrow();
    });

    it('fetchCallReport throws — does not fabricate a Form 5300 filing', async () => {
      await expect(svc.fetchCallReport('12345', '2025-Q4')).rejects.toThrow();
    });

    it('searchByName throws — does not fabricate search results', async () => {
      await expect(svc.searchByName('Test', 'PR')).rejects.toThrow();
    });

    it('fetchLatestQuarters skips failed quarters → empty, never demo-filled', async () => {
      const reports = await svc.fetchLatestQuarters('12345', 4);
      expect(reports).toEqual([]);
    });
  });

  // ─── Explicit dev opt-in: NCUA_DEMO_FALLBACK=1 ──
  describe('NCUA_DEMO_FALLBACK=1 (dev-only opt-in)', () => {
    beforeEach(() => {
      process.env.NCUA_DEMO_FALLBACK = '1';
      mockFetch(async () => {
        throw new Error('NCUA network down');
      });
    });

    it('fetchCreditUnion returns demo data instead of throwing', async () => {
      const cu = await svc.fetchCreditUnion('12345');
      expect(cu.charterNumber).toBe('12345');
      expect(typeof cu.name).toBe('string');
    });

    it('fetchCallReport returns a demo call report', async () => {
      const r = await svc.fetchCallReport('12345', '2025-Q4');
      expect(r.charterNumber).toBe('12345');
      expect(r.fields).toBeDefined();
    });

    it('searchByName returns a demo results array', async () => {
      const results = await svc.searchByName('Test', 'PR');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── Success path ──
  it('fetchCreditUnion maps a successful NCUA response', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'Cooperativa Test',
        city: 'San Juan',
        state: 'PR',
      }),
    }));
    const cu = await svc.fetchCreditUnion('54321');
    expect(cu.charterNumber).toBe('54321');
    expect(cu.name).toBe('Cooperativa Test');
  });

  it('fetchCallReport maps a successful NCUA response', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ACCT_010: 2_800_000_000 }),
    }));
    const r = await svc.fetchCallReport('54321', '2025-Q4');
    expect(r.charterNumber).toBe('54321');
    expect(r.quarter).toBe('2025-Q4');
  });
});
