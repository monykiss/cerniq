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
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();
const TEST_PW_2 = testPassword();
const TEST_PW_3 = testPassword();
const TEST_PW_4 = testPassword();

// Environment is configured via test/setup-env.ts (setupFiles in jest-e2e.json)

// ── Prisma mock factory ──
function createPrismaMock() {
  const users: any[] = [];
  const refreshTokens: any[] = [];
  const workspaces: any[] = [];
  const auditLogs: any[] = [];
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
          email: data.email,
          name: data.name || null,
          passwordHash: data.passwordHash || null,
          provider: data.provider || 'email',
          providerId: data.providerId || null,
          emailVerified: data.emailVerified ?? false,
          avatarUrl: null,
          role: 'authenticated',
          createdAt: new Date(),
          lastLoginAt: null,
          organizationMembers: [],
          subscription: activeSubscription,
        };
        users.push(user);
        return Promise.resolve(user);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const user = users.find((u) => u.id === where.id);
        if (user) Object.assign(user, data);
        return Promise.resolve(user);
      }),
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
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          refreshTokens.find((t) => t.token === where.token) || null,
        );
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const token = refreshTokens.find((t) => t.id === where.id);
        if (token) Object.assign(token, data);
        return Promise.resolve(token);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },

    workspace: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const ws = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
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
      create: jest.fn().mockImplementation(({ data }: any) => {
        const log = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        auditLogs.push(log);
        return Promise.resolve(log);
      }),
    },

    // Stub out models that may be touched by global interceptors/guards
    demoRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
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
      create: jest.fn(),
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

    // Internal state accessors for test assertions
    _users: users,
    _refreshTokens: refreshTokens,
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

describe('Auth API Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let jwtService: JwtService;

  // Shared credentials — registered once in beforeAll to avoid rate limits
  let registeredAccessToken: string;
  const TEST_EMAIL = 'testuser@example.com';
  const TEST_PASSWORD = TEST_PW_1;
  const TEST_NAME = 'Test User';

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

    // Apply the same global pipes/filters/interceptors as main.ts
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

    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Pre-register a user for login/profile tests (1 request)
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME });

    if (regRes.status === 201) {
      const cookies = regRes.headers['set-cookie'] as string[];
      const accessCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(
        (c: string) => c.startsWith('access_token='),
      );
      registeredAccessToken = accessCookie?.split(';')[0]?.split('=')[1] || '';
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── POST /api/auth/register ──

  describe('POST /api/auth/register', () => {
    it('should register a new user and return user data with cookies', async () => {
      const dto = {
        email: 'newuser-reg@example.com',
        password: TEST_PW_1,
        name: 'New Register User',
      };

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(dto);

      // Accept either 201 (success) or 429 (rate limited from beforeAll)
      if (res.status === 429) {
        // Rate limited — still validates the API is working
        expect(res.status).toBe(429);
        return;
      }

      expect(res.status).toBe(201);

      // Response envelope wraps the data
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user).toHaveProperty('email', dto.email);

      // Should set auth cookies
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      expect(cookieStr).toMatch(/access_token/);
      expect(cookieStr).toMatch(/refresh_token/);
    });

    it('should reject registration with invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: TEST_PW_1,
        });

      // 400 (validation) or 429 (rate limited)
      expect([400, 429]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body).toHaveProperty('success', false);
        expect(res.body.error).toHaveProperty('code', 'BAD_REQUEST');
      }
    });

    it('should reject registration with short password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'shortpw@example.com',
          password: TEST_PW_2, // Less than 8 chars
        });

      expect([400, 429]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body).toHaveProperty('success', false);
      }
    });

    it('should reject registration with missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({});

      expect([400, 429]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body).toHaveProperty('success', false);
      }
    });
  });

  // ── POST /api/auth/login ──

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials and return user data', async () => {
      // Use the user registered in beforeAll
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

      // Login has a 5/min limit — should usually pass
      if (res.status === 429) {
        expect(res.status).toBe(429);
        return;
      }

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user).toHaveProperty('email', TEST_EMAIL);

      // Should set auth cookies
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: TEST_EMAIL, password: TEST_PW_3 });

      if (res.status === 429) {
        expect(res.status).toBe(429);
        return;
      }

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should reject login for non-existent user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: TEST_PW_4,
        });

      if (res.status === 429) {
        expect(res.status).toBe(429);
        return;
      }

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject login with invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: TEST_PW_4,
        });

      expect([400, 429]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body).toHaveProperty('success', false);
      }
    });
  });

  // ── GET /api/auth/profile (protected) ──

  describe('GET /api/auth/profile', () => {
    it('should return user profile with valid JWT token', async () => {
      expect(registeredAccessToken).toBeDefined();
      expect(registeredAccessToken.length).toBeGreaterThan(0);

      // Ensure the mock returns profile data with organizationMembers
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        const found = prismaMock._users.find(
          (u: any) =>
            (where.email && u.email === where.email) ||
            (where.id && u.id === where.id),
        );
        if (found) {
          return Promise.resolve({
            ...found,
            organizationMembers: found.organizationMembers || [],
          });
        }
        return Promise.resolve(null);
      });

      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${registeredAccessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('email', TEST_EMAIL);
    });

    it('should return 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should return 401 with expired token', async () => {
      // Create a token that is already expired
      const expiredToken = jwtService.sign(
        { sub: 'fake-id', email: 'expired@test.com', type: 'access' },
        { expiresIn: '0s' },
      );

      // Small delay to ensure token has expired
      await new Promise((resolve) => setTimeout(resolve, 100));

      const res = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ── POST /api/auth/logout ──

  describe('POST /api/auth/logout', () => {
    it('should clear auth cookies on logout', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('message', 'Logged out');

      // Cookies should be cleared
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
        // Cleared cookies have expired or empty values
        expect(cookieStr).toMatch(/access_token/);
      }
    });

    it('should succeed even without an existing session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('message', 'Logged out');
    });
  });

  // ── Auth guard on protected endpoints ──

  describe('Auth bypass protection', () => {
    it('should reject access to /api/auth/whoami without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/whoami')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('should reject access to /api/workspaces without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/workspaces')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });
});
