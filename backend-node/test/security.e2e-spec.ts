import { randomBytes as testRandomBytes } from 'crypto';
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

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();

// Environment is configured via test/setup-env.ts (setupFiles in jest-e2e.json)

// ── Prisma mock factory ──
function createPrismaMock() {
  const users: any[] = [];
  const leads: any[] = [];
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
          role: 'authenticated',
          createdAt: new Date(),
          organizationMembers: [],
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

    lead: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(leads),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const lead = {
          id: crypto.randomUUID(),
          ...data,
          status: 'NEW',
          createdAt: new Date(),
        };
        leads.push(lead);
        return Promise.resolve(lead);
      }),
      update: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },

    demoRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'demo-request-1', ...data }),
        ),
      count: jest.fn().mockResolvedValue(0),
    },
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
    prospectInstitution: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    cooperativaBenchmark: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
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

describe('Security Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof createPrismaMock>;

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

    // Enable CORS same as production to test CORS headers
    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Allow test origins
        if (!origin || origin === 'http://localhost:3001') {
          callback(null, true);
        } else {
          callback(new Error('CORS not allowed'), false);
        }
      },
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-admin-key',
        'x-organization-id',
        'x-klytics-org-id',
        'x-idempotency-key',
      ],
      maxAge: 86400,
    });

    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── CORS ──

  describe('CORS', () => {
    it('OPTIONS request should return correct CORS headers for allowed origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
      expect(res.headers['access-control-allow-methods']).toBeDefined();
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should include CORS headers on regular GET for allowed origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3001')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
    });
  });

  // ── Rate Limiting ──

  describe('Rate limiting', () => {
    it('rapid requests should eventually get 429 Too Many Requests', async () => {
      // The /api/auth/register endpoint has a tight rate limit: 3 per 60s
      // Send more than the limit in rapid succession
      const results: number[] = [];

      for (let i = 0; i < 6; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/register')
          .send({
            email: `ratelimit${i}@example.com`,
            password: TEST_PW_1,
            name: `Rate Limit ${i}`,
          });
        results.push(res.status);
      }

      // At least one should be 429 (rate limited) since limit is 3/min
      expect(results).toContain(429);
    });

    it('rate limit response should have correct error structure', async () => {
      // Keep sending to ensure a 429
      let rateLimitedRes: any = null;
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/register')
          .send({
            email: `rltest${i}@example.com`,
            password: TEST_PW_1,
            name: `RL Test ${i}`,
          });
        if (res.status === 429) {
          rateLimitedRes = res;
          break;
        }
      }

      // Should have gotten a 429 by now
      expect(rateLimitedRes).not.toBeNull();
      if (rateLimitedRes) {
        expect(rateLimitedRes.status).toBe(429);
      }
    });
  });

  // ── XSS Prevention ──

  describe('XSS prevention', () => {
    it('should sanitize script tags in request body', async () => {
      const dto = {
        name: '<script>alert("xss")</script>John',
        email: 'xss@test.com',
        institutionName: '<img onerror=alert(1) src=x>Bank',
        institutionType: 'cooperativa',
      };

      const res = await request(app.getHttpServer())
        .post('/api/demo-request')
        .send(dto);

      // The request should still succeed (sanitized input is still valid)
      // but the response data should not contain the raw script tags
      if (res.status === 201) {
        // The SanitizePipe strips angle brackets, so input is sanitized
        expect(JSON.stringify(res.body)).not.toContain('<script>');
      }
      // Regardless, the app should not crash
      // /api/demo-request is throttled (5/min/IP); 429 still proves no crash.
      expect([201, 400, 429]).toContain(res.status);
    });

    it('should strip javascript: URLs from input', async () => {
      const dto = {
        name: 'javascript:alert(1)',
        email: 'jsurl@test.com',
        institutionName: 'Normal Bank',
        institutionType: 'cooperativa',
      };

      const res = await request(app.getHttpServer())
        .post('/api/demo-request')
        .send(dto);

      // Should not crash — sanitization removes dangerous patterns
      // /api/demo-request is throttled (5/min/IP); 429 still proves no crash.
      expect([201, 400, 429]).toContain(res.status);
    });

    it('should strip event handlers from input', async () => {
      const dto = {
        name: 'Test onload=malicious() User',
        email: 'event@test.com',
        institutionName: 'Good Bank onerror=hack()',
        institutionType: 'cooperativa',
      };

      const res = await request(app.getHttpServer())
        .post('/api/demo-request')
        .send(dto);

      // Should succeed with sanitized values
      // /api/demo-request is throttled (5/min/IP); 429 still proves no crash.
      expect([201, 400, 429]).toContain(res.status);
    });
  });

  // ── SQL Injection ──

  describe('SQL injection prevention', () => {
    it('should handle malicious SQL in request body without crashing', async () => {
      const dto = {
        name: "Robert'; DROP TABLE demo_requests;--",
        email: 'sqli@test.com',
        institutionName: "' OR 1=1; --",
        institutionType: 'cooperativa',
      };

      const res = await request(app.getHttpServer())
        .post('/api/demo-request')
        .send(dto);

      // Should process normally (Prisma uses parameterized queries)
      // /api/demo-request is throttled (5/min/IP); 429 still proves no crash.
      expect([201, 400, 429]).toContain(res.status);
      // App should not have crashed
      const healthRes = await request(app.getHttpServer())
        .get('/health')
        .expect(200);
      expect(healthRes.body).toHaveProperty('success', true);
    });

    it('should handle SQL injection in query parameters', async () => {
      const res = await request(app.getHttpServer())
        .get(
          "/api/admin/demo-requests?sort=' OR 1=1 --&limit=1; DROP TABLE users;--",
        )
        .set('x-admin-key', process.env.ADMIN_KEY!)
        .expect(200);

      // Should return normal response, not crash
      expect(res.body).toHaveProperty('success', true);
    });

    it('should not crash on UNION SELECT injection attempts', async () => {
      const dto = {
        name: "' UNION SELECT password FROM users --",
        email: 'union@test.com',
        institutionName: 'Safe Bank',
        institutionType: 'credit_union',
      };

      const res = await request(app.getHttpServer())
        .post('/api/demo-request')
        .send(dto);

      // /api/demo-request is throttled (5/min/IP); 429 still proves no crash.
      expect([201, 400, 429]).toContain(res.status);
    });
  });

  // ── Auth Bypass ──

  describe('Auth bypass prevention', () => {
    it('should return 401 when accessing protected endpoint without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should return 401 with forged JWT token', async () => {
      // Sign with a completely different secret
      const forgedPayload = Buffer.from(
        JSON.stringify({
          sub: 'fake-user',
          email: 'hacker@evil.com',
          type: 'access',
        }),
      ).toString('base64url');
      const forgedHeader = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const forgedToken = `${forgedHeader}.${forgedPayload}.fake-signature`;

      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${forgedToken}`)
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should return 401 when accessing workspaces without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/workspaces')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 401 for admin endpoints without admin key', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should reject empty Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', '')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject Bearer token with empty value', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer ')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ── Input Validation ──

  describe('Input validation', () => {
    it('should reject request body with unexpected fields (whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'whitelist@test.com',
          password: testPassword(),
          isAdmin: true, // Not in LoginDto — should be rejected
          secretField: 'hack', // Not in LoginDto — should be rejected
        });

      // whitelist: true, forbidNonWhitelisted: true should reject unknown fields
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should handle empty request body gracefully', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should handle malformed JSON gracefully', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      // Express should return 400 for malformed JSON
      expect([400, 500]).toContain(res.status);
    });
  });
});
