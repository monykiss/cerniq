import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('HealthController', () => {
  let controller: HealthController;

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    getPoolStats: jest.fn().mockReturnValue(null),
  };

  const mockCache = {
    ping: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns ok status when all dependencies are healthy', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.version).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0].status).toBe('healthy');
    expect(result.dependencies[1].status).toBe('healthy');
  });

  it('returns unhealthy status when database probe fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const result = await controller.check();

    expect(result.status).toBe('unhealthy');
    const dbDep = result.dependencies.find((d) => d.name === 'database');
    expect(dbDep!.status).toBe('unhealthy');
  });

  it('includes latencyMs for each dependency', async () => {
    const result = await controller.check();

    for (const dep of result.dependencies) {
      expect(typeof dep.latencyMs).toBe('number');
      expect(dep.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Coverage: degraded status (one healthy, one unhealthy) ────
  it('returns degraded when cache fails but database is healthy', async () => {
    mockCache.ping.mockRejectedValueOnce(new Error('Cache down'));

    const result = await controller.check();
    expect(result.status).toBe('unhealthy');
    const cacheDep = result.dependencies.find((d) => d.name === 'cache');
    expect(cacheDep!.status).toBe('unhealthy');
  });

  // ── Coverage: cache without ping method ───────────────────────
  it('returns healthy when cache has no ping method', async () => {
    const module2 = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: {} }, // No ping method
      ],
    }).compile();

    const ctrl2 = module2.get<HealthController>(HealthController);
    const result = await ctrl2.check();
    expect(result.dependencies.find((d) => d.name === 'cache')!.status).toBe(
      'healthy',
    );
  });

  // ── Coverage: no prisma / no cache (optional deps) ────────────
  it('handles undefined prisma gracefully', async () => {
    const module3 = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: undefined },
        { provide: CacheService, useValue: undefined },
      ],
    }).compile();

    const ctrl3 = module3.get<HealthController>(HealthController);
    const result = await ctrl3.check();
    // Both probes return false (no providers) -> unhealthy
    expect(result.dependencies).toHaveLength(2);
  });

  // ── Coverage: pool stats ─────────────────────────────────────
  it('includes pool stats when prisma provides them', async () => {
    mockPrisma.getPoolStats.mockReturnValue({
      total: 10,
      idle: 5,
      waiting: 0,
      max: 20,
    });
    const result = await controller.check();
    expect(result.pool).toEqual({ total: 10, idle: 5, waiting: 0, max: 20 });
  });

  // ── Coverage: APP_VERSION env var ─────────────────────────────
  it('uses APP_VERSION env var when set', async () => {
    const orig = process.env.APP_VERSION;
    process.env.APP_VERSION = '2.5.0';
    const result = await controller.check();
    expect(result.version).toBe('2.5.0');
    process.env.APP_VERSION = orig;
  });
});
