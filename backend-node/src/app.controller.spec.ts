import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AppController,
  determineOverallHealthStatus,
  getHealthMemorySnapshot,
  _resetCachedMemoryLimit,
  incrementActiveRequests,
  decrementActiveRequests,
  getActiveRequestCount,
} from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { AuthGuard } from './auth/auth.guard';
import { AdminKeyGuard } from './auth/admin-key.guard';
import { EmailService } from './email/email.service';
import { CacheService } from './cache/cache.service';
import { ReportStorageService } from './pipeline/report-storage.service';

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
  };
});

jest.mock('./prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    $queryRaw: jest.fn(),
    getPoolStats: jest.fn().mockReturnValue(null),
    demoRequest: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    institution: { count: jest.fn(), deleteMany: jest.fn() },
    balanceSheetItem: { deleteMany: jest.fn() },
    interestRateScenario: { deleteMany: jest.fn() },
    liquidityPosition: { deleteMany: jest.fn() },
    user: { count: jest.fn() },
    prospect: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    workspace: { findMany: jest.fn(), create: jest.fn() },
    reportJob: { findMany: jest.fn() },
    subscription: { count: jest.fn() },
    analysisRun: { count: jest.fn() },
    webhookSubscription: { findMany: jest.fn() },
  })),
}));

const { readFileSync } = jest.requireMock('node:fs');

describe('AppController', () => {
  let controller: AppController;
  let prisma: any;
  let cacheService: any;
  let emailService: any;

  beforeEach(async () => {
    cacheService = {
      get: jest.fn(),
      set: jest.fn(),
      ping: jest.fn().mockResolvedValue(true),
      redis: null,
    };
    emailService = {
      sendDemoRequestNotification: jest.fn().mockResolvedValue(undefined),
      sendDemoConfirmation: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        PrismaService,
        {
          provide: EmailService,
          useValue: emailService,
        },
        {
          provide: CacheService,
          useValue: cacheService,
        },
        {
          // Report storage is surfaced as a NON-CORE health check; configured
          // here so the controller can report it without S3/R2 credentials.
          provide: ReportStorageService,
          useValue: { isCloudConfigured: true },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AppController>(AppController);
    prisma = module.get<PrismaService>(PrismaService);
    readFileSync.mockReset();
    _resetCachedMemoryLimit();

    // Reset shutdown state
    (AppController as any).shuttingDown = false;
  });

  // ── Basic ──────────────────────────────────────────────────────────

  it('should return "Hello World!"', () => {
    expect(controller.getHello()).toBe('Hello World!');
  });

  // ── API Status ─────────────────────────────────────────────────────

  it('should return API status', () => {
    const status = controller.getStatus();
    expect(status.name).toBe('CERNIQ API');
    expect(status.version).toBe('2.0.0');
    expect(status.endpoints).toBeDefined();
    // The marketData/charts/risk/options/execution entries went with the
    // trading product line; the portal's report-progress socket is what
    // survives in the endpoint directory.
    expect(status.endpoints).toHaveProperty('realtime');
  });

  // ── Memory Snapshot ────────────────────────────────────────────────

  it('uses cgroup memory limits when available', () => {
    _resetCachedMemoryLimit();
    readFileSync.mockReturnValueOnce('536870912');

    const snapshot = getHealthMemorySnapshot({
      rss: 268435456,
      heapTotal: 134217728,
      heapUsed: 67108864,
      external: 0,
      arrayBuffers: 0,
    });

    expect(snapshot.source).toBe('container');
    expect(snapshot.primaryPercent).toBe(50);
    expect(snapshot.rssPercent).toBe(50);
    expect(snapshot.limitMB).toBe(512);
  });

  it('falls back to heap usage when no container limit is exposed', () => {
    _resetCachedMemoryLimit();
    readFileSync.mockImplementation(() => {
      throw new Error('missing');
    });

    const snapshot = getHealthMemorySnapshot({
      rss: 268435456,
      heapTotal: 200,
      heapUsed: 100,
      external: 0,
      arrayBuffers: 0,
    });

    expect(snapshot.source).toBe('heap');
    expect(snapshot.primaryPercent).toBe(50);
    expect(snapshot.heapPercent).toBe(50);
    expect(snapshot.rssPercent).toBeNull();
    expect(snapshot.limitMB).toBeNull();
  });

  it('ignores "max" cgroup limit', () => {
    _resetCachedMemoryLimit();
    readFileSync.mockReturnValueOnce('max');

    const snapshot = getHealthMemorySnapshot({
      rss: 268435456,
      heapTotal: 200,
      heapUsed: 100,
      external: 0,
      arrayBuffers: 0,
    });

    expect(snapshot.source).toBe('heap');
    expect(snapshot.limitMB).toBeNull();
  });

  it('handles very large cgroup values as unbounded', () => {
    _resetCachedMemoryLimit();
    // Value > 2^60 is treated as unbounded
    readFileSync.mockReturnValueOnce('9999999999999999999999');

    const snapshot = getHealthMemorySnapshot({
      rss: 100000,
      heapTotal: 200,
      heapUsed: 100,
      external: 0,
      arrayBuffers: 0,
    });

    expect(snapshot.source).toBe('heap');
    expect(snapshot.limitMB).toBeNull();
  });

  it('caches memory limit after first read', () => {
    _resetCachedMemoryLimit();
    readFileSync.mockReturnValueOnce('536870912');

    getHealthMemorySnapshot({
      rss: 100,
      heapTotal: 200,
      heapUsed: 100,
      external: 0,
      arrayBuffers: 0,
    });
    // Second call should use cache and not call readFileSync again
    readFileSync.mockClear();
    getHealthMemorySnapshot({
      rss: 100,
      heapTotal: 200,
      heapUsed: 100,
      external: 0,
      arrayBuffers: 0,
    });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  // ── determineOverallHealthStatus ───────────────────────────────────

  // Report storage is reported but must never gate overall health: an
  // unconfigured bucket silently degrades reports to a volatile in-memory
  // buffer (they 404 after the next restart), which operators must SEE — but
  // it is not a reason to pull the API out of a load balancer.
  it('reports degraded report storage without marking the platform degraded', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', cache: 'up', reportStorage: 'degraded' },
      memory: {
        source: 'container',
        primaryPercent: 10,
        heapPercent: 10,
        rssPercent: 10,
        limitMB: 1024,
        heapUsedMB: 10,
        heapTotalMB: 20,
        rssMB: 100,
      },
    });
    expect(status).toBe('ok');
  });

  it('stays ok when only optional services (a non-core check) are degraded', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', cache: 'up', optionalDependency: 'degraded' },
      memory: {
        source: 'container',
        primaryPercent: 42,
        heapPercent: 50,
        rssPercent: 42,
        heapUsedMB: 64,
        heapTotalMB: 128,
        rssMB: 256,
        limitMB: 512,
      },
    });
    expect(status).toBe('ok');
  });

  it('marks health degraded when a core service (cache) is degraded', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', cache: 'degraded', optionalDependency: 'up' },
      memory: {
        source: 'container',
        primaryPercent: 42,
        heapPercent: 50,
        rssPercent: 42,
        heapUsedMB: 64,
        heapTotalMB: 128,
        rssMB: 256,
        limitMB: 512,
      },
    });
    expect(status).toBe('degraded');
  });

  it('keeps health ok for healthy dependencies and safe memory', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', cache: 'up', optionalDependency: 'healthy' },
      memory: {
        source: 'container',
        primaryPercent: 42,
        heapPercent: 50,
        rssPercent: 42,
        heapUsedMB: 64,
        heapTotalMB: 128,
        rssMB: 256,
        limitMB: 512,
      },
    });
    expect(status).toBe('ok');
  });

  it('marks health down when DB is disconnected', () => {
    const status = determineOverallHealthStatus({
      dbConnected: false,
      checks: { api: 'up', database: 'down' },
      memory: {
        source: 'heap',
        primaryPercent: 10,
        heapPercent: 10,
        rssPercent: null,
        heapUsedMB: 10,
        heapTotalMB: 100,
        rssMB: 20,
        limitMB: null,
      },
    });
    expect(status).toBe('down');
  });

  it('marks health degraded when container memory >= 90%', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up' },
      memory: {
        source: 'container',
        primaryPercent: 92,
        heapPercent: 50,
        rssPercent: 92,
        heapUsedMB: 64,
        heapTotalMB: 128,
        rssMB: 460,
        limitMB: 500,
      },
    });
    expect(status).toBe('degraded');
  });

  it('marks health degraded when heap memory >= 95%', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up' },
      memory: {
        source: 'heap',
        primaryPercent: 96,
        heapPercent: 96,
        rssPercent: null,
        heapUsedMB: 96,
        heapTotalMB: 100,
        rssMB: 100,
        limitMB: null,
      },
    });
    expect(status).toBe('degraded');
  });

  it('marks health degraded for "down" dependency status', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', cache: 'down' },
      memory: {
        source: 'heap',
        primaryPercent: 30,
        heapPercent: 30,
        rssPercent: null,
        heapUsedMB: 30,
        heapTotalMB: 100,
        rssMB: 50,
        limitMB: null,
      },
    });
    expect(status).toBe('degraded');
  });

  it('stays ok when only optional service is unhealthy', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'up', optionalDependency: 'unhealthy' },
      memory: {
        source: 'heap',
        primaryPercent: 30,
        heapPercent: 30,
        rssPercent: null,
        heapUsedMB: 30,
        heapTotalMB: 100,
        rssMB: 50,
        limitMB: null,
      },
    });
    expect(status).toBe('ok');
  });

  it('marks health degraded when core api service is unhealthy', () => {
    const status = determineOverallHealthStatus({
      dbConnected: true,
      checks: { api: 'unhealthy', optionalDependency: 'up' },
      memory: {
        source: 'heap',
        primaryPercent: 30,
        heapPercent: 30,
        rssPercent: null,
        heapUsedMB: 30,
        heapTotalMB: 100,
        rssMB: 50,
        limitMB: null,
      },
    });
    expect(status).toBe('degraded');
  });

  // ── Active Request Counter ─────────────────────────────────────────

  describe('active request counter', () => {
    it('increments and decrements', () => {
      const baseline = getActiveRequestCount();
      incrementActiveRequests();
      expect(getActiveRequestCount()).toBe(baseline + 1);
      decrementActiveRequests();
      expect(getActiveRequestCount()).toBe(baseline);
    });
  });

  // ── Health Endpoint ────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns healthy status when all checks pass', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const result = await controller.getHealth();
      expect(result.status).toBeDefined();
      expect(result.db).toBe('connected');
      expect(result.version).toBe('2.0.0');
      expect(result.services).toBeDefined();
      expect(result.services.api).toBe('up');
      expect(result.services.database).toBe('up');
      expect(result.memory).toBeDefined();
    });

    it('reports database down on query failure', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      const result = await controller.getHealth();
      expect(result.db).toBe('error');
      expect(result.services.database).toBe('down');
      expect(result.status).toBe('down');
    });

    it('reports cache degraded when ping fails', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(false);
      const result = await controller.getHealth();
      expect(result.services.cache).toBe('degraded');
    });

    it('reports cache degraded when ping throws', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockRejectedValue(new Error('Redis down'));
      const result = await controller.getHealth();
      expect(result.services.cache).toBe('degraded');
    });

    it('includes pool stats when available', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.getPoolStats.mockReturnValue({
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
        maxSize: 10,
      });
      const result = await controller.getHealth();
      expect(result.connectionPool).toBeDefined();
      expect(result.connectionPool!.totalConnections).toBe(5);
    });
  });

  // ── Liveness ───────────────────────────────────────────────────────

  describe('GET /health/live', () => {
    it('returns alive status', () => {
      const result = controller.getLiveness();
      expect(result.status).toBe('alive');
      expect(result.pid).toBe(process.pid);
      expect(typeof result.uptime).toBe('number');
    });
  });

  // ── Ready ──────────────────────────────────────────────────────────

  describe('GET /ready', () => {
    it('returns ready when all checks pass', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(true);
      const res = { status: jest.fn() };
      const result = await controller.getReady(res as any);
      expect(result.ready).toBe(true);
      expect(result.checks.database).toBe('ok');
      expect(result.checks.cache).toBe('ok');
      expect(result.checks.shutdown).toBe('ok');
    });

    it('returns not ready when DB fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('DB down'));
      cacheService.ping.mockResolvedValue(true);
      const res = { status: jest.fn() };
      const result = await controller.getReady(res as any);
      expect(result.ready).toBe(false);
      expect(result.checks.database).toBe('fail');
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns not ready during shutdown', async () => {
      (AppController as any).shuttingDown = true;
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(true);
      const res = { status: jest.fn() };
      const result = await controller.getReady(res as any);
      expect(result.ready).toBe(false);
      expect(result.checks.shutdown).toBe('fail');
    });
  });

  // ── Demo Request ───────────────────────────────────────────────────

  describe('POST /api/demo-request', () => {
    it('creates a demo request and returns id', async () => {
      prisma.demoRequest.create.mockResolvedValue({ id: 'dr-1' });
      prisma.prospect.create.mockResolvedValue({ id: 'p-1' });

      const body = {
        email: 'test@example.com',
        name: 'John Doe',
        institutionName: 'Coop Test',
        institutionType: 'cooperativa',
        totalAssets: '$100M-$500M',
      };
      const result = await controller.submitDemoRequest(body as any);
      expect(result.id).toBe('dr-1');
      expect(result.message).toBe('Demo request received');
      expect(prisma.demoRequest.create).toHaveBeenCalled();
    });

    it('sends email notifications', async () => {
      prisma.demoRequest.create.mockResolvedValue({ id: 'dr-2' });
      prisma.prospect.create.mockResolvedValue({ id: 'p-2' });

      const body = {
        email: 'test@example.com',
        name: 'Jane Doe',
      };
      await controller.submitDemoRequest(body as any);

      expect(emailService.sendDemoRequestNotification).toHaveBeenCalledWith(
        body,
      );
      expect(emailService.sendDemoConfirmation).toHaveBeenCalledWith({
        name: 'Jane Doe',
        email: 'test@example.com',
      });
    });

    it('does not fail when prospect creation fails', async () => {
      prisma.demoRequest.create.mockResolvedValue({ id: 'dr-3' });
      prisma.prospect.create.mockRejectedValue(new Error('Duplicate'));

      const body = { email: 'test@example.com', name: 'Dup User' };
      const result = await controller.submitDemoRequest(body as any);
      // Should still return success
      expect(result.id).toBe('dr-3');
    });
  });

  // ── Admin Endpoints ────────────────────────────────────────────────
  // Post-AdminKeyGuard refactor: admin-key enforcement lives in
  // `AdminKeyGuard` (10-case suite in `admin-key.guard.spec.ts`).
  // The pre-refactor `controller.getDemoRequests('wrong-key')` pattern
  // no longer detects auth — guards run at HTTP layer, direct method
  // invocation bypasses them. Replaced with: per-handler reflection
  // locks asserting the method-level guard is wired, plus delegation
  // tests with the guard arity dropped.

  describe('admin endpoints', () => {
    describe('AdminKeyGuard wiring (reflection locks)', () => {
      const assertGuardOn = (handlerName: keyof AppController) => {
        const handler = (AppController.prototype as any)[handlerName];
        const guards = Reflect.getMetadata('__guards__', handler) ?? [];
        const names = guards.map(
          (g: { name?: string }) => g?.name ?? String(g),
        );
        expect(names).toContain('AdminKeyGuard');
      };

      it('AdminKeyGuard guards getDemoRequests', () => {
        assertGuardOn('getDemoRequests');
      });
      it('AdminKeyGuard guards resetDemoData', () => {
        assertGuardOn('resetDemoData');
      });
      it('AdminKeyGuard guards getAdminStats', () => {
        assertGuardOn('getAdminStats');
      });
      it('AdminKeyGuard guards getAdminOps', () => {
        assertGuardOn('getAdminOps');
      });
    });

    describe('GET /api/admin/demo-requests', () => {
      it('returns demo requests', async () => {
        prisma.demoRequest.findMany.mockResolvedValue([{ id: 'dr-1' }]);
        const result = await controller.getDemoRequests();
        expect(result).toHaveLength(1);
      });
    });

    describe('DELETE /api/admin/demo-data', () => {
      it('clears demo data', async () => {
        prisma.balanceSheetItem.deleteMany.mockResolvedValue({});
        prisma.interestRateScenario.deleteMany.mockResolvedValue({});
        prisma.liquidityPosition.deleteMany.mockResolvedValue({});
        prisma.institution.deleteMany.mockResolvedValue({});

        const result = await controller.resetDemoData();
        expect(result.message).toBe('Demo data cleared');
        expect(prisma.balanceSheetItem.deleteMany).toHaveBeenCalled();
        expect(prisma.institution.deleteMany).toHaveBeenCalled();
      });
    });

    describe('GET /api/admin/stats', () => {
      it('returns admin stats', async () => {
        prisma.demoRequest.count.mockResolvedValue(10);
        prisma.institution.count.mockResolvedValue(5);
        prisma.user.count.mockResolvedValueOnce(20).mockResolvedValueOnce(3);
        prisma.prospect.count.mockResolvedValue(15);

        const result = await controller.getAdminStats();
        expect(result.demoRequests).toBe(10);
        expect(result.institutions).toBe(5);
        expect(result.users).toBe(20);
        expect(result.prospects).toBe(15);
      });
    });
  });

  // ── Workspace Endpoints ────────────────────────────────────────────

  describe('workspace endpoints', () => {
    it('GET /api/workspaces returns user workspaces', async () => {
      prisma.workspace.findMany.mockResolvedValue([
        { id: 'ws1', name: 'My Workspace' },
      ]);
      const req = { user: { userId: 'u1' } };
      const result = await controller.getWorkspaces(req);
      expect(result).toHaveLength(1);
    });

    it('POST /api/workspaces creates workspace', async () => {
      prisma.workspace.create.mockResolvedValue({ id: 'ws2', name: 'New WS' });
      const req = { user: { userId: 'u1' } };
      const result = await controller.createWorkspace(req, { name: 'New WS' });
      expect(result.name).toBe('New WS');
    });

    it('POST /api/workspaces uses default name', async () => {
      prisma.workspace.create.mockResolvedValue({
        id: 'ws3',
        name: 'My Workspace',
      });
      const req = { user: { userId: 'u1' } };
      await controller.createWorkspace(req, { name: '' });
      expect(prisma.workspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'My Workspace' }),
        }),
      );
    });
  });

  // ── Shutdown draining ───────────────────────────────────────
  describe('GET /health during shutdown', () => {
    it('throws ServiceUnavailableException during shutdown', async () => {
      (AppController as any).shuttingDown = true;
      const { ServiceUnavailableException } = require('@nestjs/common');
      await expect(controller.getHealth()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('markShuttingDown', () => {
    it('sets the shutting down flag', () => {
      (AppController as any).shuttingDown = false;
      AppController.markShuttingDown();
      expect((AppController as any).shuttingDown).toBe(true);
    });
  });

  // ── GET /health/detailed ────────────────────────────────────
  describe('GET /health/detailed', () => {
    it('returns detailed health when HEALTH_DETAILS_PUBLIC is enabled', async () => {
      process.env.HEALTH_DETAILS_PUBLIC = 'true';
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(true);

      const result = await controller.getHealthDetailed();
      expect(result.status).toBeDefined();
      expect(result.services).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.version).toBe('2.0.0');

      delete process.env.HEALTH_DETAILS_PUBLIC;
    });

    it('returns detailed health in non-production', async () => {
      delete process.env.HEALTH_DETAILS_PUBLIC;
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(true);

      const result = await controller.getHealthDetailed();
      expect(result.status).toBeDefined();

      process.env.NODE_ENV = origEnv;
    });

    it('reports degraded when DB is down in detailed health', async () => {
      delete process.env.HEALTH_DETAILS_PUBLIC;
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      prisma.$queryRaw.mockRejectedValue(new Error('DB down'));
      cacheService.ping.mockResolvedValue(true);

      const result = await controller.getHealthDetailed();
      expect(result.services.database.status).toBe('down');
      expect(result.status).toBe('degraded');

      process.env.NODE_ENV = origEnv;
    });

    it('includes pool stats in detailed health', async () => {
      delete process.env.HEALTH_DETAILS_PUBLIC;
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(true);
      prisma.getPoolStats.mockReturnValue({
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
        maxSize: 10,
      });

      const result = await controller.getHealthDetailed();
      expect(result.connectionPool).toBeDefined();
      expect(result.connectionPool!.totalConnections).toBe(5);

      process.env.NODE_ENV = origEnv;
    });
  });

  // ── GET /ready — cache failure ──────────────────────────────
  describe('GET /ready — cache failures', () => {
    it('returns not ready when cache ping throws', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockRejectedValue(new Error('Redis down'));
      const res = { status: jest.fn() };
      const result = await controller.getReady(res as any);
      expect(result.ready).toBe(false);
      expect(result.checks.cache).toBe('fail');
    });

    it('returns not ready when cache ping returns false', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      cacheService.ping.mockResolvedValue(false);
      const res = { status: jest.fn() };
      const result = await controller.getReady(res as any);
      expect(result.ready).toBe(false);
      expect(result.checks.cache).toBe('fail');
    });
  });

  // ── GET /metrics ────────────────────────────────────────────
  describe('GET /metrics', () => {
    it('returns process metrics', async () => {
      prisma.getPoolStats.mockReturnValue({
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
        maxSize: 10,
      });

      const result = await controller.getMetrics();
      expect(result.pid).toBe(process.pid);
      expect(result.memory).toBeDefined();
      expect(result.eventLoopLag).toBeDefined();
      expect(result.connectionPool).toBeDefined();
    });

    it('returns default pool stats when getPoolStats returns null', async () => {
      prisma.getPoolStats.mockReturnValue(null);

      const result = await controller.getMetrics();
      expect(result.connectionPool).toEqual({ active: 0, idle: 0, max: 10 });
    });
  });

  // ── GET /api/admin/ops ──────────────────────────────────────
  describe('GET /api/admin/ops', () => {
    it('returns ops data', async () => {
      prisma.reportJob.findMany.mockResolvedValue([{ id: 'job-1' }]);
      prisma.subscription.count.mockResolvedValue(5);
      prisma.analysisRun.count.mockResolvedValue(42);

      const result = await controller.getAdminOps();
      expect(result.recentJobs).toHaveLength(1);
      expect(result.activeSubscriptions).toBe(5);
      expect(result.totalAnalysisRuns).toBe(42);
      expect(result.performanceMetrics).toBeDefined();
    });
  });

  // ── GET /api/admin/webhook-delivery-logs ────────────────────
  describe('GET /api/admin/webhook-delivery-logs', () => {
    it('returns webhook subscription stats', async () => {
      prisma.webhookSubscription.findMany.mockResolvedValue([
        { id: 'ws-1', isActive: true, failureCount: 0 },
        { id: 'ws-2', isActive: true, failureCount: 3 },
        { id: 'ws-3', isActive: false, failureCount: 0 },
      ]);

      const result = await controller.getWebhookDeliveryLogs();
      expect(result.total).toBe(3);
      expect(result.active).toBe(2);
      expect(result.failing).toBe(1);
      expect(result.disabled).toBe(1);
    });
  });

  // Note: admin-key auth behavior previously tested here as
  // `describe('verifyAdmin', ...)` (env-unset / length-mismatch cases)
  // is now covered by the 10-case suite in `admin-key.guard.spec.ts`.
  // The guard owns the auth contract; this controller spec owns only
  // wiring + delegation.
});
