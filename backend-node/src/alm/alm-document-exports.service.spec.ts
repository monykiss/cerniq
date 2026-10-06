import { AlmDocumentExportsService } from './alm-document-exports.service';

describe('AlmDocumentExportsService', () => {
  let service: AlmDocumentExportsService;
  let almEnterprise: any;
  let reportsService: any;
  let sampleReportFactory: any;
  let previewReports: any;

  beforeEach(() => {
    almEnterprise = {
      getInstitution: jest.fn().mockResolvedValue({
        id: 'inst-1',
        name: 'Cooperativa Test',
        reportingDate: '2026-04-01T00:00:00.000Z',
      }),
    };
    reportsService = {
      generateALMReport: jest.fn().mockResolvedValue(Buffer.from('alm-report')),
      generateAndRecordArtifact: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('alm-report') }),
    };
    sampleReportFactory = {
      generateSampleReport: jest
        .fn()
        .mockResolvedValue(Buffer.from('sample-report')),
    };
    previewReports = {
      getPreviewDefinition: jest.fn().mockReturnValue({
        slug: 'cooperativa-ejemplo-este',
        name: 'Cooperativa Ejemplo Este',
      }),
      generatePreviewReport: jest
        .fn()
        .mockResolvedValue(Buffer.from('preview-report')),
    };

    service = new AlmDocumentExportsService(
      almEnterprise,
      reportsService,
      sampleReportFactory,
      previewReports,
    );
  });

  it('lists institutional exports as manifest records', async () => {
    const manifests = await service.listInstitutionExports('inst-1');

    expect(manifests).toHaveLength(2);
    expect(manifests[0]).toEqual(
      expect.objectContaining({
        kind: 'alm_report',
        audience: 'internal',
        sourceInstitutionId: 'inst-1',
      }),
    );
  });

  it('generates a sample export with shared metadata', async () => {
    const document = await service.generateSampleExport('12345', 'es');

    expect(sampleReportFactory.generateSampleReport).toHaveBeenCalledWith(
      '12345',
      'es',
    );
    expect(document.manifest.kind).toBe('sample_report');
    expect(document.manifest.watermark).toContain('SAMPLE DOCUMENT');
  });

  it('generates preview exports through the preview report service', async () => {
    const document = await service.generatePreviewExport(
      'cooperativa-ejemplo-este',
      'en',
    );

    expect(previewReports.generatePreviewReport).toHaveBeenCalledWith(
      'cooperativa-ejemplo-este',
      'en',
    );
    expect(document.manifest.kind).toBe('preview_report');
    expect(document.manifest.downloadUrl).toContain(
      '/api/alm/previews/cooperativa-ejemplo-este/report',
    );
  });

  describe('error handling — failed generation returns error manifest', () => {
    it('returns failed manifest with null downloadUrl when institution report generation throws', async () => {
      reportsService.generateAndRecordArtifact.mockRejectedValue(
        new Error('PDF engine crash'),
      );

      const result = await service.generateInstitutionExport('inst-1', 'en');

      expect(result.manifest.status).toBe('failed');
      expect(result.manifest.downloadUrl).toBeNull();
      expect(result.manifest.kind).toBe('alm_report');
      expect(result.manifest.sourceInstitutionId).toBe('inst-1');
      expect(result.buffer.length).toBe(0);
    });

    it('returns failed manifest when sample report generation throws', async () => {
      sampleReportFactory.generateSampleReport.mockRejectedValue(
        new Error('NCUA pull timeout'),
      );

      const result = await service.generateSampleExport('99999', 'es');

      expect(result.manifest.status).toBe('failed');
      expect(result.manifest.downloadUrl).toBeNull();
      expect(result.manifest.kind).toBe('sample_report');
      expect(result.buffer.length).toBe(0);
    });

    it('returns failed manifest when preview report generation throws', async () => {
      previewReports.generatePreviewReport.mockRejectedValue(
        new Error('PDFKit OOM'),
      );

      const result = await service.generatePreviewExport(
        'cooperativa-ejemplo-este',
        'es',
      );

      expect(result.manifest.status).toBe('failed');
      expect(result.manifest.downloadUrl).toBeNull();
      expect(result.manifest.kind).toBe('preview_report');
      expect(result.buffer.length).toBe(0);
    });
  });
});
