import { NotFoundException } from '@nestjs/common';
import { PortalDocumentExportsService } from './portal-document-exports.service';

describe('PortalDocumentExportsService', () => {
  let service: PortalDocumentExportsService;
  let prisma: any;
  let alcoPackService: any;
  let almEnterprise: any;
  let portalAlmReport: any;

  beforeEach(() => {
    prisma = {
      reportJob: {
        findFirst: jest.fn(),
      },
    };
    alcoPackService = {
      buildALCOPack: jest.fn().mockResolvedValue(Buffer.from('board-pack')),
    };
    almEnterprise = {
      getInstitution: jest.fn().mockResolvedValue({ name: 'Cooperativa Test' }),
    };
    portalAlmReport = {
      buildManifestStub: jest.fn().mockImplementation((params: any) => ({
        id: `alm_report:${params.jobId}:${params.language}`,
        kind: 'alm_report',
        language: params.language,
        audience: 'internal',
        filename: `alm-${params.language}.pdf`,
        mimeType: 'application/pdf',
        status: 'ready',
        downloadUrl: `/api/portal/jobs/${params.jobId}/alm-report?lang=${params.language}`,
        generatedAt: null,
        expiresAt: null,
        watermark: null,
        sourceInstitutionId: params.institutionId,
        sourceJobId: params.jobId,
      })),
      generateAlmReportExport: jest.fn(),
      buildDownloadUrl: jest.fn(),
    };

    service = new PortalDocumentExportsService(
      prisma,
      alcoPackService,
      almEnterprise,
      portalAlmReport,
    );
  });

  it('returns report and ALCO manifests for complete jobs', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      institutionId: 'inst-1',
      institutionName: 'Cooperativa Test',
      status: 'COMPLETE',
      reportUrl: 'https://r2.example.com/report-es.pdf',
      reportUrlEn: 'https://r2.example.com/report-en.pdf',
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    });

    const manifests = await service.listJobExports('user-1', 'job-1');

    expect(manifests).toHaveLength(4);
    expect(manifests.map((manifest) => manifest.kind)).toEqual(
      expect.arrayContaining(['alm_report', 'alco_pack']),
    );
    expect(
      manifests
        .filter((manifest) => manifest.kind === 'alm_report')
        .every((manifest) =>
          manifest.downloadUrl?.includes('/api/portal/jobs/job-1/alm-report'),
        ),
    ).toBe(true);
  });

  it('builds an ALCO pack export payload', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      institutionId: 'inst-1',
      institutionName: 'Cooperativa Test',
      status: 'COMPLETE',
      reportUrl: null,
      reportUrlEn: null,
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    });

    const document = await service.generateAlcoPackExport(
      'user-1',
      'job-1',
      'en',
    );

    expect(alcoPackService.buildALCOPack).toHaveBeenCalledWith('inst-1', 'en');
    expect(document.manifest.kind).toBe('alco_pack');
    expect(document.manifest.language).toBe('en');
  });

  it('throws when a job cannot be found', async () => {
    prisma.reportJob.findFirst.mockResolvedValue(null);

    await expect(service.listJobExports('user-1', 'job-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('exposes on-demand alm_report manifests for demo-provisioned jobs', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({
      id: 'demo-job',
      userId: 'user-1',
      institutionId: 'inst-2',
      institutionName: 'Cooperativa Ejemplo Centro',
      status: 'COMPLETE',
      reportUrl: null,
      reportUrlEn: null,
      triggeredBy: 'demo_provision',
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    });

    const manifests = await service.listJobExports('user-1', 'demo-job');

    const almReports = manifests.filter((m) => m.kind === 'alm_report');
    expect(almReports).toHaveLength(2);
    expect(almReports.map((m) => m.language).sort()).toEqual(['en', 'es']);
    expect(portalAlmReport.buildManifestStub).toHaveBeenCalledTimes(2);
    expect(portalAlmReport.buildManifestStub).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredBy: 'demo_provision',
        institutionId: 'inst-2',
      }),
    );
  });

  it('falls back to on-demand alm_report when stored URLs are relative paths', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({
      id: 'job-3',
      userId: 'user-1',
      institutionId: 'inst-3',
      institutionName: 'Cooperativa Test',
      status: 'COMPLETE',
      // Relative path (R2 not configured) — listJobExports should still surface a downloadable manifest
      reportUrl: 'reports/job-3/report_es.pdf',
      reportUrlEn: 'reports/job-3/report_en.pdf',
      triggeredBy: 'payment',
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    });

    const manifests = await service.listJobExports('user-1', 'job-3');

    const almReports = manifests.filter((m) => m.kind === 'alm_report');
    expect(almReports).toHaveLength(2);
    expect(
      almReports.every((manifest) =>
        manifest.downloadUrl?.includes('/api/portal/jobs/job-3/alm-report'),
      ),
    ).toBe(true);
    expect(portalAlmReport.buildManifestStub).toHaveBeenCalledTimes(2);
  });

  it('summarizes a complete job as ready when report and board-pack exports exist in both languages', () => {
    const summary = service.summarizeJobExportsForRecord({
      id: 'job-ready',
      userId: 'user-1',
      institutionId: 'inst-1',
      institutionName: 'Cooperativa Test',
      status: 'COMPLETE',
      reportUrl: null,
      reportUrlEn: null,
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      triggeredBy: 'portal_submit',
    });

    expect(summary).toEqual(
      expect.objectContaining({
        status: 'ready',
        readyReportLanguages: ['es', 'en'],
        readyBoardPackLanguages: ['es', 'en'],
      }),
    );
  });

  it('summarizes a complete legacy job as partial when only raw report URLs exist', () => {
    const summary = service.summarizeJobExportsForRecord({
      id: 'job-legacy',
      userId: 'user-1',
      institutionId: null,
      institutionName: 'Legacy Coop',
      status: 'COMPLETE',
      reportUrl: 'https://r2.example.com/report-es.pdf',
      reportUrlEn: 'https://r2.example.com/report-en.pdf',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
      completedAt: new Date('2026-04-06T12:00:00.000Z'),
      triggeredBy: 'portal_submit',
    });

    expect(summary).toEqual(
      expect.objectContaining({
        status: 'partial',
        readyReportLanguages: ['es', 'en'],
        missingBoardPackLanguages: ['es', 'en'],
      }),
    );
  });
});
