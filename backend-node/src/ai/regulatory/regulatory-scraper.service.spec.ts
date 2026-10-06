import { RegulatoryScraperService } from './regulatory-scraper.service';

describe('RegulatoryScraperService', () => {
  let service: RegulatoryScraperService;
  const mockPrisma = {
    regulatoryPublication: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    service = new RegulatoryScraperService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return regulatory sources list', () => {
    const sources = service.getSources();
    expect(sources.length).toBe(3);
    expect(sources.map((s) => s.regulator)).toEqual(['COSSEC', 'OCIF', 'NCUA']);
  });

  it('should handle scan with no new publications', async () => {
    // Mock fetch to return an error so fetchPublications returns []
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await service.runDailyScan();
    expect(result.scanned).toBe(3);
    expect(result.newFound).toBe(0);

    global.fetch = origFetch;
  });

  it('should count scan errors correctly', async () => {
    // fetchPublications catches internally, so errors go to the outer catch
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await service.runDailyScan();
    expect(result.scanned).toBe(3);
    expect(result.errors.length).toBe(0); // errors from fetchPublications are caught internally

    global.fetch = origFetch;
  });

  it('should skip existing publications in the database', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<h2>Circular 2026-01 Capital Requirements Update</h2><h2>Circular 2026-02 Liquidity Standards Review</h2>',
        ),
    });
    mockPrisma.regulatoryPublication.findUnique.mockResolvedValue({
      id: 'existing',
    });

    const result = await service.runDailyScan();
    expect(result.newFound).toBe(0);
    expect(mockPrisma.regulatoryPublication.create).not.toHaveBeenCalled();

    global.fetch = origFetch;
  });

  // ── Coverage boost: parsePublications branches ──

  it('creates new publications when not in database', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<h2>Circular 2026-03 New Risk Framework Standard</h2>',
        ),
    });
    mockPrisma.regulatoryPublication.findUnique.mockResolvedValue(null);
    mockPrisma.regulatoryPublication.create.mockResolvedValue({ id: 'new1' });

    const result = await service.runDailyScan();
    expect(result.newFound).toBeGreaterThan(0);
    expect(mockPrisma.regulatoryPublication.create).toHaveBeenCalled();

    global.fetch = origFetch;
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await service.runDailyScan();
    expect(result.scanned).toBe(3);
    expect(result.newFound).toBe(0);

    global.fetch = origFetch;
  });

  it('filters out short titles (<16 chars) from parsed publications', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<h2>Short</h2><h2>This is a long enough title for parsing</h2>',
        ),
    });
    mockPrisma.regulatoryPublication.findUnique.mockResolvedValue(null);
    mockPrisma.regulatoryPublication.create.mockResolvedValue({ id: 'new2' });

    const result = await service.runDailyScan();
    // Only the long title should be created
    expect(result.newFound).toBe(3); // 3 sources * 1 valid title each
    global.fetch = origFetch;
  });

  it('handles database create error in outer catch', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<h2>Circular 2026-04 Important Regulatory Update</h2>',
        ),
    });
    mockPrisma.regulatoryPublication.findUnique.mockResolvedValue(null);
    mockPrisma.regulatoryPublication.create.mockRejectedValue(
      new Error('DB write error'),
    );

    const result = await service.runDailyScan();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('DB write error');

    global.fetch = origFetch;
  });

  it('parses <a> tags as well as <h2>/<h3>', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<a href="/doc">Circular 2026-05 Asset Quality Review Standards</a>',
        ),
    });
    mockPrisma.regulatoryPublication.findUnique.mockResolvedValue(null);
    mockPrisma.regulatoryPublication.create.mockResolvedValue({ id: 'new3' });

    const result = await service.runDailyScan();
    expect(result.newFound).toBeGreaterThan(0);

    global.fetch = origFetch;
  });
});
