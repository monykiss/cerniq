import { USVIExpansionService } from './usvi-expansion.service';

describe('USVIExpansionService', () => {
  let service: USVIExpansionService;

  beforeEach(() => {
    service = new USVIExpansionService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return USVI jurisdiction', () => {
    const result = service.getUSVIFramework();
    expect(result.jurisdiction).toBe('USVI');
    expect(result.regulator).toContain('FSC');
  });

  it('should return compliance calendar with due dates', () => {
    const result = service.getUSVIFramework();
    expect(result.complianceCalendar.length).toBe(4);
    for (const item of result.complianceCalendar) {
      expect(item.nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.regulatoryRef).toBeTruthy();
    }
  });

  it('should include peer benchmarks with quartile data', () => {
    const result = service.getUSVIFramework();
    expect(result.peerBenchmarks.nim.p50).toBeGreaterThan(0);
    expect(result.peerBenchmarks.lcr.p50).toBeGreaterThan(0);
    expect(result.peerBenchmarks.nwr.p50).toBeGreaterThan(0);
  });

  it('should list PR vs USVI differences', () => {
    const result = service.getUSVIFramework();
    expect(result.differences.length).toBeGreaterThan(5);
    const areas = result.differences.map((d) => d.area);
    expect(areas).toContain('Primary Regulator');
    expect(areas).toContain('Economic Driver');
  });

  it('should include economic parameters', () => {
    const result = service.getUSVIFramework();
    expect(result.economicParams.creditUnionCount).toBe(6);
    expect(result.economicParams.dominantSector).toBe('tourism');
    expect(result.economicParams.hurricaneSeasonMonths.length).toBe(5);
  });
});
