import { Injectable, Logger } from '@nestjs/common';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { ReportsService } from './reports/reports.service';
import { PreviewReportService } from './preview-report.service';
import { SampleReportFactoryService } from './sample-report-factory.service';
import { buildManifestId, createPdfManifest } from './document-exports.util';
import {
  DocumentExportManifest,
  GeneratedDocumentExport,
} from './document-exports.types';

@Injectable()
export class AlmDocumentExportsService {
  private readonly logger = new Logger(AlmDocumentExportsService.name);

  constructor(
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly reportsService: ReportsService,
    private readonly sampleReportFactory: SampleReportFactoryService,
    private readonly previewReports: PreviewReportService,
  ) {}

  async listInstitutionExports(
    institutionId: string,
  ): Promise<DocumentExportManifest[]> {
    const institution = await this.almEnterprise.getInstitution(institutionId);
    const generatedAt = institution.reportingDate || new Date();

    return (['es', 'en'] as const).map((language) =>
      createPdfManifest({
        id: buildManifestId('alm_report', institutionId, language),
        kind: 'alm_report',
        language,
        audience: 'internal',
        status: 'ready',
        downloadUrl: `/api/alm/${institutionId}/report?lang=${language}`,
        sourceInstitutionId: institutionId,
        institutionName: institution.name,
        generatedAt,
        watermark: null,
      }),
    );
  }

  async generateInstitutionExport(
    institutionId: string,
    language: 'en' | 'es' = 'en',
  ): Promise<GeneratedDocumentExport> {
    const institution = await this.almEnterprise.getInstitution(institutionId);

    try {
      const { buffer } = await this.reportsService.generateAndRecordArtifact(
        institutionId,
        {
          language,
          storageLocator: `/api/alm/${institutionId}/report?lang=${language}`,
          generatedBy: 'document-export',
        },
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('alm_report', institutionId, language),
          kind: 'alm_report',
          language,
          audience: 'internal',
          status: 'ready',
          downloadUrl: `/api/alm/${institutionId}/report?lang=${language}`,
          sourceInstitutionId: institutionId,
          institutionName: institution.name,
          generatedAt: new Date(),
          watermark: null,
        }),
        buffer,
      };
    } catch (err) {
      this.logger.error(
        `Report generation failed for institution ${institutionId}: ${err}`,
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('alm_report', institutionId, language),
          kind: 'alm_report',
          language,
          audience: 'internal',
          status: 'failed',
          downloadUrl: null,
          sourceInstitutionId: institutionId,
          institutionName: institution.name,
          generatedAt: new Date(),
          watermark: null,
        }),
        buffer: Buffer.alloc(0),
      };
    }
  }

  listSampleExports(charterNumber: string): DocumentExportManifest[] {
    return (['es', 'en'] as const).map((language) =>
      createPdfManifest({
        id: buildManifestId('sample_report', charterNumber, language),
        kind: 'sample_report',
        language,
        audience: 'sample',
        status: 'ready',
        downloadUrl: `/api/alm/sample-report/${encodeURIComponent(charterNumber)}?lang=${language}`,
        sourceLabel: charterNumber,
        generatedAt: new Date(),
      }),
    );
  }

  async generateSampleExport(
    charterNumber: string,
    language: 'en' | 'es' = 'en',
  ): Promise<GeneratedDocumentExport> {
    try {
      const buffer = await this.sampleReportFactory.generateSampleReport(
        charterNumber,
        language,
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('sample_report', charterNumber, language),
          kind: 'sample_report',
          language,
          audience: 'sample',
          status: 'ready',
          downloadUrl: `/api/alm/sample-report/${encodeURIComponent(charterNumber)}?lang=${language}`,
          sourceLabel: charterNumber,
          generatedAt: new Date(),
        }),
        buffer,
      };
    } catch (err) {
      this.logger.error(
        `Sample report generation failed for charter ${charterNumber}: ${err}`,
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('sample_report', charterNumber, language),
          kind: 'sample_report',
          language,
          audience: 'sample',
          status: 'failed',
          downloadUrl: null,
          sourceLabel: charterNumber,
          generatedAt: new Date(),
        }),
        buffer: Buffer.alloc(0),
      };
    }
  }

  listPreviewExports(slug: string): DocumentExportManifest[] {
    const preview = this.previewReports.getPreviewDefinition(slug);
    return (['es', 'en'] as const).map((language) =>
      createPdfManifest({
        id: buildManifestId('preview_report', slug, language),
        kind: 'preview_report',
        language,
        audience: 'sample',
        status: 'ready',
        downloadUrl: `/api/alm/previews/${encodeURIComponent(slug)}/report?lang=${language}`,
        sourceLabel: preview.name,
        generatedAt: new Date(),
      }),
    );
  }

  async generatePreviewExport(
    slug: string,
    language: 'en' | 'es' = 'es',
  ): Promise<GeneratedDocumentExport> {
    const preview = this.previewReports.getPreviewDefinition(slug);
    try {
      const buffer = await this.previewReports.generatePreviewReport(
        slug,
        language,
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('preview_report', slug, language),
          kind: 'preview_report',
          language,
          audience: 'sample',
          status: 'ready',
          downloadUrl: `/api/alm/previews/${encodeURIComponent(slug)}/report?lang=${language}`,
          sourceLabel: preview.name,
          generatedAt: new Date(),
        }),
        buffer,
      };
    } catch (err) {
      this.logger.error(
        `Preview report generation failed for slug ${slug}: ${err}`,
      );
      return {
        manifest: createPdfManifest({
          id: buildManifestId('preview_report', slug, language),
          kind: 'preview_report',
          language,
          audience: 'sample',
          status: 'failed',
          downloadUrl: null,
          sourceLabel: preview.name,
          generatedAt: new Date(),
        }),
        buffer: Buffer.alloc(0),
      };
    }
  }
}
