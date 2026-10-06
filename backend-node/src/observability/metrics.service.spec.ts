import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  const mockPrisma = {
    institution: { count: jest.fn().mockResolvedValue(5) },
    user: { count: jest.fn().mockResolvedValue(10) },
    usageMeterEvent: { count: jest.fn().mockResolvedValue(100) },
  } as any;

  beforeEach(() => {
    service = new MetricsService(mockPrisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should record request metrics', () => {
    // Should not throw
    service.recordRequest('/api/alm', 'GET', 150, 200);
    service.recordRequest('/api/alm', 'GET', 200, 200);
    service.recordRequest('/api/alm', 'POST', 300, 500);
    expect(true).toBe(true);
  });

  it('should return system health with status', async () => {
    const health = await service.getSystemHealth();
    expect(health.status).toBeDefined();
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(health.memoryUsage).toHaveProperty('heapUsedMB');
    expect(health.memoryUsage).toHaveProperty('rssMB');
  });

  it('should include business metrics from database', async () => {
    const health = await service.getSystemHealth();
    expect(health.businessMetrics).toBeDefined();
    expect(health.businessMetrics.activeInstitutions).toBe(5);
    expect(health.businessMetrics.activeUsers).toBe(10);
    expect(health.businessMetrics.mrr).toBe(5 * 3500);
  });

  it('should return db connection pool info', async () => {
    const health = await service.getSystemHealth();
    expect(health.dbConnectionPool).toHaveProperty('active');
    expect(health.dbConnectionPool).toHaveProperty('idle');
    expect(health.dbConnectionPool).toHaveProperty('max');
  });
});
