import { randomBytes as testRandomBytes } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import _request from 'supertest';
const request = (_request as any).default ?? _request;
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { CacheService } from '../src/cache/cache.service';
import { PlatformAccessService } from '../src/auth/platform-access.service';
import { EmailService } from '../src/email/email.service';
import { AuditService } from '../src/audit/audit.service';
import { DataCryptoService } from '../src/crypto/data-crypto.service';
import { CSVIngestionService } from '../src/alm/csv-ingestion.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { SanitizePipe } from '../src/common/pipes/sanitize.pipe';
import { RolesGuard } from '../src/auth/roles.guard';
import * as crypto from 'crypto';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();

function createPrismaMock() {
  const users: any[] = [];
  const refreshTokens: any[] = [];
  const workspaces: any[] = [];
  const institutions: any[] = [];
  const reportJobs: any[] = [];
  const ingestionLogs: any[] = [];
  const balanceSheetItems: any[] = [];

  const matchesWhere = (
    row: Record<string, any>,
    where: Record<string, any> = {},
  ) => {
    return Object.entries(where).every(([key, value]) => {
      if (
        value &&
        typeof value === 'object' &&
        'in' in value &&
        Array.isArray(value.in)
      ) {
        return value.in.includes(row[key]);
      }
      if (value && typeof value === 'object' && 'not' in value) {
        return row[key] !== value.not;
      }
      return row[key] === value;
    });
  };

  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getPoolStats: jest.fn().mockReturnValue(null),

    user: {
      findUnique: jest.fn().mockImplementation(({ where, include }: any) => {
        const user =
          users.find(
            (candidate) =>
              (where.email && candidate.email === where.email) ||
              (where.id && candidate.id === where.id),
          ) || null;

        if (!user) {
          return Promise.resolve(null);
        }

        if (include?.subscription) {
          return Promise.resolve({
            ...user,
            subscription: {
              tier: 'monthly',
              status: 'active',
            },
            organizationMembers: [],
          });
        }

        return Promise.resolve(user);
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
          role: 'OWNER',
          createdAt: new Date(),
          lastLoginAt: null,
        };
        users.push(user);
        return Promise.resolve(user);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const user = users.find((candidate) => candidate.id === where.id);
        if (user) {
          Object.assign(user, data);
        }
        return Promise.resolve(user || null);
      }),
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
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          refreshTokens.find((token) => token.token === where.token) || null,
        );
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },

    workspace: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const matches = workspaces.filter((workspace) =>
          matchesWhere(workspace, where),
        );
        return Promise.resolve(matches[0] || null);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const workspace = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
        };
        workspaces.push(workspace);
        return Promise.resolve(workspace);
      }),
      findMany: jest.fn().mockImplementation(({ where, orderBy }: any = {}) => {
        const matches = workspaces.filter((workspace) =>
          matchesWhere(workspace, where),
        );
        if (orderBy?.createdAt === 'asc') {
          matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return Promise.resolve(matches);
      }),
    },

    institution: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where, orderBy }: any = {}) => {
          const matches = institutions.filter((institution) =>
            matchesWhere(institution, where),
          );
          if (orderBy?.createdAt === 'asc') {
            matches.sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
            );
          }
          if (orderBy?.updatedAt === 'desc') {
            matches.sort(
              (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
            );
          }
          return Promise.resolve(matches[0] || null);
        }),
      findUnique: jest.fn().mockImplementation(({ where, include }: any) => {
        const institution =
          institutions.find((candidate) => candidate.id === where.id) || null;
        if (!institution) {
          return Promise.resolve(null);
        }
        if (include) {
          return Promise.resolve({
            ...institution,
            balanceSheetItems: balanceSheetItems.filter(
              (item) => item.institutionId === institution.id,
            ),
            liquidityPositions: [],
          });
        }
        return Promise.resolve(institution);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const institution = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        institutions.push(institution);
        return Promise.resolve(institution);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const institution = institutions.find(
          (candidate) => candidate.id === where.id,
        );
        if (institution) {
          Object.assign(institution, data, { updatedAt: new Date() });
        }
        return Promise.resolve(institution || null);
      }),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },

    balanceSheetItem: {
      createMany: jest.fn().mockImplementation(({ data }: any) => {
        data.forEach((item: any) =>
          balanceSheetItems.push({
            id: crypto.randomUUID(),
            ...item,
            createdAt: new Date(),
          }),
        );
        return Promise.resolve({ count: data.length });
      }),
      deleteMany: jest.fn(),
    },

    ingestionLog: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const log = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
        };
        ingestionLogs.push(log);
        return Promise.resolve(log);
      }),
      findFirst: jest.fn().mockImplementation(({ where }: any = {}) => {
        const matches = ingestionLogs.filter((log) => matchesWhere(log, where));
        return Promise.resolve(matches[matches.length - 1] || null);
      }),
    },

    reportJob: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where, orderBy }: any = {}) => {
          const matches = reportJobs.filter((job) => {
            if (where?.status?.in) {
              const { status: _status, ...restWhere } = where;
              return (
                matchesWhere(job, restWhere) &&
                where.status.in.includes(job.status)
              );
            }
            return matchesWhere(job, where);
          });
          if (orderBy?.createdAt === 'desc') {
            matches.sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
          }
          return Promise.resolve(matches[0] || null);
        }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const job = {
          id: crypto.randomUUID(),
          analysisPeriod: null,
          previousJobId: null,
          submittedAt: null,
          processingStartedAt: null,
          completedAt: null,
          reportUrl: null,
          reportUrlEn: null,
          errorMessage: null,
          retryCount: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        reportJobs.push(job);
        return Promise.resolve(job);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const job = reportJobs.find((candidate) => candidate.id === where.id);
        if (job) {
          Object.assign(job, data, { updatedAt: new Date() });
        }
        return Promise.resolve(job || null);
      }),
      count: jest.fn().mockResolvedValue(0),
    },

    auditLog: {
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
    },

    demoRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    prospect: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    subscription: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({
        tier: 'monthly',
        status: 'active',
      }),
    },
    analysisRun: { count: jest.fn().mockResolvedValue(0) },
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
      count: jest.fn().mockResolvedValue(0),
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

    _state: {
      users,
      workspaces,
      institutions,
      reportJobs,
      balanceSheetItems,
      ingestionLogs,
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

describe('Portal API Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let accessToken: string;
  let csvIngestionMock: { parseCSV: jest.Mock };

  beforeAll(async () => {
    prismaMock = createPrismaMock();
    const cacheServiceMock = createCacheMock();
    csvIngestionMock = {
      parseCSV: jest.fn(),
    };
    const platformAccessMock = {
      isMasterAccountEmail: jest.fn().mockReturnValue(false),
      normalizeMasterAccountEmail: jest.fn((email?: string) =>
        typeof email === 'string' ? email.trim().toLowerCase() : '',
      ),
      evaluateAccess: jest.fn().mockReturnValue({
        platformAccessAllowed: true,
        isPlatformAdmin: false,
        isPaid: true,
        isDemo: false,
        effectiveTier: 'monthly',
        effectiveStatus: 'active',
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'paid',
      }),
      getAccessForUser: jest.fn().mockResolvedValue({
        platformAccessAllowed: true,
        isPlatformAdmin: false,
        isPaid: true,
        isDemo: false,
        effectiveTier: 'monthly',
        effectiveStatus: 'active',
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'paid',
      }),
      buildForbiddenPayload: jest.fn().mockReturnValue({
        code: 'PLATFORM_ACCESS_REQUIRED',
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(CacheService)
      .useValue(cacheServiceMock)
      .overrideProvider(CSVIngestionService)
      .useValue(csvIngestionMock)
      .overrideProvider(PlatformAccessService)
      .useValue(platformAccessMock)
      .overrideProvider(EmailService)
      .useValue({
        sendDataSubmissionAck: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(AuditService)
      .useValue({ log: jest.fn() })
      .overrideProvider(DataCryptoService)
      .useValue({
        encrypt: jest.fn().mockReturnValue('encrypted-csv'),
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
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

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'portal-e2e@example.com',
        password: TEST_PW_1,
        name: 'Portal E2E',
      })
      .expect(201);

    const setCookies = registerRes.headers['set-cookie'] || [];
    const accessCookie = (
      Array.isArray(setCookies) ? setCookies : [setCookies]
    ).find((cookie: string) => cookie.startsWith('access_token='));
    accessToken = accessCookie?.split(';')[0]?.split('=')[1] || '';
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    prismaMock._state.workspaces.splice(0);
    prismaMock._state.institutions.splice(0);
    prismaMock._state.reportJobs.splice(0);
    prismaMock._state.balanceSheetItems.splice(0);
    prismaMock._state.ingestionLogs.splice(0);
    csvIngestionMock.parseCSV.mockReset();
  });

  it('creates a new actionable report cycle and links it to a real workspace institution', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/portal/jobs/open-cycle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        institutionName: 'Cooperativa Portal',
        institutionType: 'cooperativa',
        primaryRegulator: 'COSSEC',
        preferredLanguage: 'es',
        totalAssets: 42000000,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      institutionName: 'Cooperativa Portal',
      institutionId: expect.any(String),
      status: 'AWAITING_DATA',
    });
    expect(res.body.data.nextHref).toContain('/portal/submit?jobId=');

    expect(prismaMock._state.workspaces).toHaveLength(1);
    expect(prismaMock._state.institutions).toHaveLength(1);
    expect(prismaMock._state.reportJobs).toHaveLength(1);
    expect(prismaMock._state.institutions[0].workspaceId).toBe(
      prismaMock._state.workspaces[0].id,
    );
    expect(prismaMock._state.reportJobs[0].institutionId).toBe(
      prismaMock._state.institutions[0].id,
    );
  });

  it('reuses the latest actionable job instead of duplicating open cycles', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/portal/jobs/open-cycle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/portal/jobs/open-cycle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    expect(second.body.data.jobId).toBe(first.body.data.jobId);
    expect(prismaMock._state.reportJobs).toHaveLength(1);
  });

  it('accepts CSV submission, imports balance-sheet items, and queues the job', async () => {
    csvIngestionMock.parseCSV.mockReturnValueOnce({
      valid: true,
      items: [
        {
          category: 'asset',
          subcategory: 'commercial_loans',
          name: 'CRE Loans',
          balance: 10,
          rate: 0.0525,
          duration: 4.5,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          name: 'Checking',
          balance: 8,
          rate: 0.005,
          duration: 0.1,
          rateType: 'variable',
        },
      ],
      warnings: [],
      errors: [],
      summary: {
        totalRows: 2,
        validRows: 2,
        errorRows: 0,
        totalAssets: 10,
        totalLiabilities: 8,
      },
    });

    const cycle = await request(app.getHttpServer())
      .post('/api/portal/jobs/open-cycle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        institutionName: 'Cooperativa Upload',
      })
      .expect(201);

    const jobId = cycle.body.data.jobId as string;

    const res = await request(app.getHttpServer())
      .post(`/api/portal/jobs/${jobId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('analysisPeriod', 'Q1-2026')
      .attach(
        'file',
        Buffer.from(
          'category,subcategory,name,balance,rate,duration,rateType\nasset,commercial_loans,CRE Loans,10,5.25,4.5,fixed\nliability,demand_deposits,Checking,8,0.50,0.1,variable',
        ),
        'balance_sheet.csv',
      )
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      valid: true,
      status: 'QUEUED',
      jobId,
      institutionName: 'Cooperativa Upload',
      itemsImported: 2,
      nextHref: `/portal/reports/${jobId}`,
    });

    const storedJob = prismaMock._state.reportJobs.find(
      (job) => job.id === jobId,
    );
    expect(storedJob.status).toBe('QUEUED');
    expect(storedJob.analysisPeriod).toBe('Q1-2026');
    expect(prismaMock._state.balanceSheetItems).toHaveLength(2);
    expect(prismaMock._state.ingestionLogs).toHaveLength(1);
    expect(prismaMock._state.institutions[0].workspaceId).toBeTruthy();
  });

  it('returns VALIDATION_FAILED and preserves the actionable job on invalid CSV', async () => {
    csvIngestionMock.parseCSV.mockReturnValueOnce({
      valid: false,
      items: [],
      warnings: [],
      errors: [
        {
          row: 1,
          field: 'subcategory',
          message: 'Missing required columns',
        },
      ],
      summary: {
        totalRows: 1,
        validRows: 0,
        errorRows: 1,
        totalAssets: 0,
        totalLiabilities: 0,
      },
    });

    const cycle = await request(app.getHttpServer())
      .post('/api/portal/jobs/open-cycle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        institutionName: 'Cooperativa Invalid',
      })
      .expect(201);

    const jobId = cycle.body.data.jobId as string;

    const res = await request(app.getHttpServer())
      .post(`/api/portal/jobs/${jobId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('category,name\nasset,Cash'), 'invalid.csv')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe('VALIDATION_FAILED');
    expect(res.body.data.nextHref).toBe(`/portal/submit?jobId=${jobId}`);

    const storedJob = prismaMock._state.reportJobs.find(
      (job) => job.id === jobId,
    );
    expect(storedJob.status).toBe('VALIDATION_FAILED');
    expect(storedJob.errorMessage).toBeTruthy();
  });

  it('returns canonical report-job detail and export manifests for a completed job', async () => {
    const createdAt = new Date('2026-04-18T12:00:00.000Z');
    const completedAt = new Date('2026-04-18T12:05:00.000Z');
    const currentUserId = prismaMock._state.users[0]?.id;
    const workspaceId = crypto.randomUUID();
    const institutionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    prismaMock._state.workspaces.push({
      id: workspaceId,
      ownerId: currentUserId,
      name: 'Portal Workspace',
      createdAt,
    });
    prismaMock._state.institutions.push({
      id: institutionId,
      workspaceId,
      name: 'Cooperativa Ready',
      type: 'cooperativa',
      preferredLanguage: 'es',
      createdAt,
      updatedAt: completedAt,
    });
    prismaMock._state.reportJobs.push({
      id: jobId,
      userId: currentUserId,
      institutionId,
      institutionName: 'Cooperativa Ready',
      status: 'COMPLETE',
      analysisPeriod: 'Q1-2026',
      previousJobId: null,
      submittedAt: createdAt,
      processingStartedAt: createdAt,
      completedAt,
      createdAt,
      reportUrl: null,
      reportUrlEn: null,
      reportLang: 'es',
      errorMessage: null,
      triggeredBy: 'portal_cycle_bootstrap',
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/portal/jobs/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(detail.body.success).toBe(true);
    expect(detail.body.data).toMatchObject({
      id: jobId,
      institutionId,
      status: 'COMPLETE',
      exportSummary: {
        manifestPath: `/api/portal/jobs/${jobId}/exports`,
        status: 'ready',
      },
    });

    const exportsRes = await request(app.getHttpServer())
      .get(`/api/portal/jobs/${jobId}/exports`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(exportsRes.body.success).toBe(true);
    expect(exportsRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'alm_report',
          language: 'es',
          downloadUrl: `/api/portal/jobs/${jobId}/alm-report?lang=es`,
        }),
        expect.objectContaining({
          kind: 'alm_report',
          language: 'en',
          downloadUrl: `/api/portal/jobs/${jobId}/alm-report?lang=en`,
        }),
      ]),
    );
  });
});
