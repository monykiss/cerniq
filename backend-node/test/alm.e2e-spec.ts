import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import _request from 'supertest';
const request = (_request as any).default ?? _request;
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { SanitizePipe } from '../src/common/pipes/sanitize.pipe';
import * as crypto from 'crypto';

// Environment is configured via test/setup-env.ts (setupFiles in jest-e2e.json)

// ── Prisma mock factory ──
function createPrismaMock() {
  const leads: any[] = [];
  const demoRequests: any[] = [];
  const users: any[] = [];
  const refreshTokens: any[] = [];
  const workspaces: any[] = [];
  const activeSubscription = {
    tier: 'monthly',
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 7 * 86400_000),
  };

  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getPoolStats: jest.fn().mockReturnValue(null),

    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(leads)),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }: any) => {
        const found = leads.find((l) => l.id === where.id);
        if (!found) return Promise.reject(new Error('Not found'));
        return Promise.resolve(found);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const lead = {
          id: crypto.randomUUID(),
          ...data,
          status: 'NEW',
          createdAt: new Date(),
          notes: null,
          reportSentAt: null,
          convertedAt: null,
          revenueAmount: null,
        };
        leads.push(lead);
        return Promise.resolve(lead);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const lead = leads.find((l) => l.id === where.id);
        if (lead) Object.assign(lead, data);
        return Promise.resolve(lead);
      }),
      count: jest.fn().mockResolvedValue(0),
    },

    demoRequest: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(demoRequests)),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const req = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        demoRequests.push(req);
        return Promise.resolve(req);
      }),
      count: jest.fn().mockResolvedValue(demoRequests.length),
    },

    user: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        const user =
          users.find(
            (u) =>
              (where.email && u.email === where.email) ||
              (where.id && u.id === where.id),
          ) || null;
        return Promise.resolve(
          user
            ? {
                ...user,
                subscription: user.subscription ?? activeSubscription,
              }
            : null,
        );
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const user = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
          subscription: activeSubscription,
        };
        users.push(user);
        return Promise.resolve(user);
      }),
      update: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },

    refreshToken: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const token = {
          id: crypto.randomUUID(),
          ...data,
          revokedAt: null,
          createdAt: new Date(),
        };
        refreshTokens.push(token);
        return Promise.resolve(token);
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },

    workspace: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const ws = { id: crypto.randomUUID(), name: 'Test', ...data };
        workspaces.push(ws);
        return Promise.resolve(ws);
      }),
      findFirst: jest.fn().mockImplementation(({ where }: any = {}) => {
        return Promise.resolve(
          workspaces.find((ws) =>
            where?.ownerId ? ws.ownerId === where.ownerId : true,
          ) || null,
        );
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },

    auditLog: {
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
    },

    // Models required by AppController
    institution: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
    balanceSheetItem: { deleteMany: jest.fn() },
    interestRateScenario: { deleteMany: jest.fn() },
    liquidityPosition: { deleteMany: jest.fn() },
    prospect: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(null),
    },
    subscription: { count: jest.fn().mockResolvedValue(0) },
    analysisRun: { count: jest.fn().mockResolvedValue(0) },
    reportJob: { findMany: jest.fn().mockResolvedValue([]) },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    apiKey: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },

    // Leads-specific models
    prospectInstitution: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: crypto.randomUUID(),
        name: 'Test Cooperativa',
        estimatedAssets: 200_000_000,
        location: 'San Juan',
        contactRole: 'CFO',
      }),
    },
    cooperativaBenchmark: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
    },
  };
}

function createCacheMock() {
  return {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    getStats: jest.fn().mockResolvedValue({ hits: 0, misses: 0, keys: 0 }),
    flushAll: jest.fn().mockResolvedValue(undefined),
    getOrSet: jest.fn().mockImplementation(async (_key, fetchFn) => fetchFn()),
  };
}

describe('ALM & Health API Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  const ADMIN_KEY = process.env.ADMIN_KEY!;

  beforeAll(async () => {
    prismaMock = createPrismaMock();
    const cacheServiceMock = createCacheMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(CacheService)
      .useValue(cacheServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalPipes(new SanitizePipe());

    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── GET /health ──

  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('status');
      expect(['ok', 'degraded', 'down']).toContain(res.body.data.status);
      expect(res.body.data).toHaveProperty('version');
      expect(res.body.data).toHaveProperty('uptime');
      expect(res.body.data).toHaveProperty('timestamp');
      expect(res.body.data).toHaveProperty('services');
    });

    it('should include memory and database info', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.body.data).toHaveProperty('memoryPercent');
      expect(typeof res.body.data.memoryPercent).toBe('number');
      expect(res.body.data).toHaveProperty('db');
      expect(res.body.data).toHaveProperty('memory');
      expect(res.body.data.memory).toHaveProperty('heapUsedMB');
    });
  });

  // ── GET /ready ──

  describe('GET /ready', () => {
    it('should return readiness check status', async () => {
      const res = await request(app.getHttpServer()).get('/ready').expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('ready');
      expect(typeof res.body.data.ready).toBe('boolean');
      expect(res.body.data).toHaveProperty('checks');
      expect(res.body.data.checks).toHaveProperty('database');
      expect(res.body.data).toHaveProperty('timestamp');
    });

    it('should report database check result', async () => {
      const res = await request(app.getHttpServer()).get('/ready').expect(200);

      expect(['ok', 'fail']).toContain(res.body.data.checks.database);
    });
  });

  // ── GET /api/admin/demo-requests ──

  describe('GET /api/admin/demo-requests', () => {
    it('should return demo requests with valid admin key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/demo-requests')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should reject without admin key (401)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/demo-requests')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should reject with invalid admin key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/demo-requests')
        .set('x-admin-key', 'wrong-key-value')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });

  // ── Admin stats endpoint ──

  describe('GET /api/admin/stats', () => {
    it('should return admin stats with valid admin key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('x-admin-key', ADMIN_KEY)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('demoRequests');
      expect(res.body.data).toHaveProperty('institutions');
      expect(res.body.data).toHaveProperty('users');
    });

    it('should reject without admin key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ── GET /api/status ──

  describe('GET /api/status', () => {
    it('should return API status information', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/status')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('version');
      expect(res.body.data).toHaveProperty('endpoints');
    });
  });
});
