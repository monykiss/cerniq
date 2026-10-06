/**
 * HTTP integration spec for portal file-export endpoints.
 *
 * This sits one level above the unit specs: it spins up a real NestJS
 * HTTP server (Express) with mocked services/guards, and exercises the
 * routes via supertest. The goal is to catch regressions in:
 *
 *   1. Route wiring (did the controller decorators survive a refactor?)
 *   2. HTTP status codes (404 vs 400 vs 200 for edge cases)
 *   3. PDF response headers (Content-Type, Content-Disposition, length)
 *   4. Guard execution order (Auth → Roles → handler)
 *   5. Binary body integrity (PDF bytes arrive unmodified at the client)
 *
 * Every one of these has bitten us before when the unit specs were green
 * but an upstream decorator got clobbered or a response header dropped.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';

import { PortalController } from './portal.controller';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import { CSVIngestionService } from '../alm/csv-ingestion.service';
import { CsvSchemaInferenceService } from '../alm/csv-schema-inference.service';
import { IngestionLogsService } from '../alm/ingestion-logs.service';
import { EmailService } from '../email/email.service';
import { DataCryptoService } from '../crypto/data-crypto.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { PlatformAccessService } from '../auth/platform-access.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PortalDocumentExportsService } from './portal-document-exports.service';
import { PortalAlmReportService } from './portal-alm-report.service';
import { DemoSeatService } from './demo-seat.service';
import { ReportStorageService } from '../pipeline/report-storage.service';

describe('Portal export endpoints (HTTP integration)', () => {
  let app: INestApplication;

  // Shared fixtures
  const paidUser = { userId: 'user-paid', email: 'cfo@test.example' };
  const fakePdf = Buffer.from('%PDF-1.4\n%CERNIQ-TEST-FIXTURE\n%%EOF', 'utf-8');

  const prisma = {
    reportJob: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findUnique: jest.fn(), create: jest.fn() },
    subscription: { findUnique: jest.fn() },
    institution: { findMany: jest.fn().mockResolvedValue([]) },
    apiKey: { count: jest.fn().mockResolvedValue(0) },
    workspace: { findMany: jest.fn(), create: jest.fn() },
  };

  const portalExports = {
    listJobExports: jest.fn(),
    generateAlcoPackExport: jest.fn(),
  };

  const portalAlmReport = {
    generateAlmReportExport: jest.fn(),
    buildDownloadUrl: jest
      .fn()
      .mockReturnValue('/api/portal/jobs/j1/alm-report?lang=es'),
    buildManifestStub: jest.fn(),
  };

  const demoSeats = {
    markViewed: jest.fn().mockResolvedValue(undefined),
    getDemoSeatForUser: jest.fn().mockResolvedValue(null),
  };

  const almEnterprise = {
    getInstitution: jest.fn(),
  };

  const platformAccess = {
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
    buildForbiddenPayload: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PortalController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: AlmEnterpriseService, useValue: almEnterprise },
        { provide: CSVIngestionService, useValue: { parseCSV: jest.fn() } },
        CsvSchemaInferenceService,
        {
          provide: IngestionLogsService,
          useValue: { listJobLogs: jest.fn(), recordLog: jest.fn() },
        },
        {
          provide: EmailService,
          useValue: { sendDataSubmissionAck: jest.fn() },
        },
        {
          provide: DataCryptoService,
          useValue: { encrypt: jest.fn().mockReturnValue('enc') },
        },
        { provide: BillingService, useValue: { generateMagicLink: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: PlatformAccessService, useValue: platformAccess },
        { provide: PortalDocumentExportsService, useValue: portalExports },
        { provide: PortalAlmReportService, useValue: portalAlmReport },
        { provide: DemoSeatService, useValue: demoSeats },
        {
          provide: ReportStorageService,
          useValue: {
            isCloudConfigured: false,
            upload: jest.fn().mockResolvedValue('test-key'),
            getSignedUrl: jest
              .fn()
              .mockResolvedValue('/api/portal/reports/download/test-key'),
            getLocalBuffer: jest.fn().mockReturnValue(null),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          // Inject req.user so downstream controller code works
          const req = ctx.switchToHttp().getRequest();
          req.user = paidUser;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    platformAccess.getAccessForUser.mockResolvedValue({
      platformAccessAllowed: true,
      isPlatformAdmin: false,
      isPaid: true,
      isDemo: false,
      effectiveTier: 'monthly',
      effectiveStatus: 'active',
      effectivePeriodEnd: null,
      daysRemaining: null,
      reason: 'paid',
    });
  });

  describe('GET /api/portal/jobs/:jobId/exports', () => {
    it('returns the manifest list for a completed job', async () => {
      portalExports.listJobExports.mockResolvedValue([
        {
          id: 'alm_report:j1:es',
          kind: 'alm_report',
          language: 'es',
          filename: 'alm-report-test-es-2026-04-08.pdf',
          mimeType: 'application/pdf',
          status: 'ready',
          downloadUrl: '/api/portal/jobs/j1/alm-report?lang=es',
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/exports')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        kind: 'alm_report',
        language: 'es',
        mimeType: 'application/pdf',
      });
      expect(portalExports.listJobExports).toHaveBeenCalledWith(
        'user-paid',
        'j1',
      );
    });

    it('returns 403 when the user has no platform access', async () => {
      platformAccess.getAccessForUser.mockResolvedValueOnce({
        platformAccessAllowed: false,
        isPlatformAdmin: false,
        isPaid: false,
        isDemo: false,
        effectiveTier: 'free',
        effectiveStatus: null,
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'subscription_required',
      });
      platformAccess.buildForbiddenPayload.mockReturnValueOnce({
        code: 'PLATFORM_ACCESS_REQUIRED',
      });

      await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/exports')
        .expect(403);
    });
  });

  describe('GET /api/portal/jobs/:jobId/alm-report', () => {
    it('streams the PDF with correct Content-Type and Content-Disposition', async () => {
      portalAlmReport.generateAlmReportExport.mockResolvedValue({
        manifest: {
          id: 'alm_report:j1:es',
          kind: 'alm_report',
          language: 'es',
          audience: 'internal',
          filename: 'alm-report-cooperativa-ejemplo-centro-es-2026-04-08.pdf',
          mimeType: 'application/pdf',
          status: 'ready',
          downloadUrl: '/api/portal/jobs/j1/alm-report?lang=es',
          generatedAt: new Date().toISOString(),
          expiresAt: null,
          watermark: 'PRELIMINARY — Built from public filings',
          sourceInstitutionId: 'inst-1',
          sourceJobId: 'j1',
        },
        buffer: fakePdf,
      });

      const res = await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/alm-report?lang=es')
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(res.headers['content-length']).toBe(String(fakePdf.length));
      expect(res.headers['x-cerniq-document-kind']).toBe('alm_report');
      expect(res.headers['x-cerniq-document-language']).toBe('es');

      // Verify body bytes arrive unmodified
      expect(Buffer.from(res.body).equals(fakePdf)).toBe(true);
      expect(portalAlmReport.generateAlmReportExport).toHaveBeenCalledWith(
        'user-paid',
        'j1',
        'es',
      );
    });

    it('defaults to Spanish when lang query param is missing', async () => {
      portalAlmReport.generateAlmReportExport.mockResolvedValue({
        manifest: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          kind: 'alm_report',
          language: 'es',
          audience: 'internal',
        },
        buffer: fakePdf,
      });

      await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/alm-report')
        .expect(200);

      expect(portalAlmReport.generateAlmReportExport).toHaveBeenCalledWith(
        'user-paid',
        'j1',
        'es',
      );
    });

    it('returns 200 with EN manifest when lang=en', async () => {
      portalAlmReport.generateAlmReportExport.mockResolvedValue({
        manifest: {
          filename: 'alm-report-en.pdf',
          mimeType: 'application/pdf',
          kind: 'alm_report',
          language: 'en',
          audience: 'internal',
        },
        buffer: fakePdf,
      });

      const res = await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/alm-report?lang=en')
        .expect(200);

      expect(res.headers['x-cerniq-document-language']).toBe('en');
      expect(portalAlmReport.generateAlmReportExport).toHaveBeenCalledWith(
        'user-paid',
        'j1',
        'en',
      );
    });

    it('marks viewed on successful stream so admin engagement picks it up', async () => {
      portalAlmReport.generateAlmReportExport.mockResolvedValue({
        manifest: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          kind: 'alm_report',
          language: 'es',
          audience: 'internal',
        },
        buffer: fakePdf,
      });

      await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/alm-report?lang=es')
        .expect(200);

      expect(demoSeats.markViewed).toHaveBeenCalledWith('user-paid');
    });

    it('surfaces 404 as-is from the export service', async () => {
      portalAlmReport.generateAlmReportExport.mockRejectedValueOnce(
        new NotFoundException('Job not found'),
      );

      await request(app.getHttpServer())
        .get('/api/portal/jobs/j-bad/alm-report')
        .expect(404);
    });
  });

  describe('POST /api/portal/jobs/:jobId/alco-pack', () => {
    it('streams the ALCO pack PDF for a completed job', async () => {
      prisma.reportJob.findFirst.mockResolvedValue({
        id: 'j1',
        userId: 'user-paid',
        status: 'COMPLETE',
        institutionId: 'inst-1',
        institutionName: 'Cooperativa Test',
      });
      portalExports.generateAlcoPackExport.mockResolvedValue({
        manifest: {
          id: 'alco_pack:j1:es',
          kind: 'alco_pack',
          language: 'es',
          audience: 'internal',
          filename: 'board-package-cooperativa-test-es-2026-04-08.pdf',
          mimeType: 'application/pdf',
          status: 'ready',
          downloadUrl: '/api/portal/jobs/j1/alco-pack?lang=es',
          generatedAt: new Date().toISOString(),
          expiresAt: null,
          watermark: null,
          sourceInstitutionId: 'inst-1',
          sourceJobId: 'j1',
        },
        buffer: fakePdf,
      });

      const res = await request(app.getHttpServer())
        .post('/api/portal/jobs/j1/alco-pack')
        .expect(201);

      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['x-cerniq-document-kind']).toBe('alco_pack');
      expect(res.headers['content-length']).toBe(String(fakePdf.length));
      expect(Buffer.from(res.body).equals(fakePdf)).toBe(true);
    });

    it('returns 404 when the job does not exist', async () => {
      prisma.reportJob.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/portal/jobs/j-missing/alco-pack')
        .expect(404);
    });

    it('returns 400 when the job is not COMPLETE', async () => {
      prisma.reportJob.findFirst.mockResolvedValue({
        id: 'j1',
        userId: 'user-paid',
        status: 'QUEUED',
        institutionId: 'inst-1',
      });

      await request(app.getHttpServer())
        .post('/api/portal/jobs/j1/alco-pack')
        .expect(400);
    });

    it('returns 400 when no institution is linked to the job', async () => {
      prisma.reportJob.findFirst.mockResolvedValue({
        id: 'j1',
        userId: 'user-paid',
        status: 'COMPLETE',
        institutionId: null,
      });

      await request(app.getHttpServer())
        .post('/api/portal/jobs/j1/alco-pack')
        .expect(400);
    });
  });

  describe('GET /api/portal/jobs/:jobId/alco-pack', () => {
    it('streams the ALCO pack PDF for a completed job via the manifest download URL', async () => {
      prisma.reportJob.findFirst.mockResolvedValue({
        id: 'j1',
        userId: 'user-paid',
        status: 'COMPLETE',
        institutionId: 'inst-1',
        institutionName: 'Cooperativa Test',
      });
      portalExports.generateAlcoPackExport.mockResolvedValue({
        manifest: {
          id: 'alco_pack:j1:en',
          kind: 'alco_pack',
          language: 'en',
          audience: 'internal',
          filename: 'board-package-cooperativa-test-en-2026-04-08.pdf',
          mimeType: 'application/pdf',
          status: 'ready',
          downloadUrl: '/api/portal/jobs/j1/alco-pack?lang=en',
          generatedAt: new Date().toISOString(),
          expiresAt: null,
          watermark: null,
          sourceInstitutionId: 'inst-1',
          sourceJobId: 'j1',
        },
        buffer: fakePdf,
      });

      const res = await request(app.getHttpServer())
        .get('/api/portal/jobs/j1/alco-pack?lang=en')
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['x-cerniq-document-kind']).toBe('alco_pack');
      expect(res.headers['x-cerniq-document-language']).toBe('en');
      expect(Buffer.from(res.body).equals(fakePdf)).toBe(true);
    });
  });
});
