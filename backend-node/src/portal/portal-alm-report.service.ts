import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReportsService } from '../alm/reports/reports.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import {
  buildManifestId,
  createPdfManifest,
} from '../alm/document-exports.util';
import {
  DocumentExportManifest,
  GeneratedDocumentExport,
} from '../alm/document-exports.types';

/**
 * On-demand ALM report PDF generator for the portal.
 *
 * Used by:
 * - Demo seats (no R2 storage required — every download is freshly generated
 *   from the institution's balance sheet items)
 * - Real users as a fallback when the pipeline-uploaded R2 URL is missing or
 *   has expired
 *
 * The generated PDF carries an optional watermark line — for demo seats this
 * surfaces the COSSEC / NCUA provenance string so the prospect always knows
 * the report was built from public filings.
 */
@Injectable()
export class PortalAlmReportService {
  private readonly logger = new Logger(PortalAlmReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly almEnterprise: AlmEnterpriseService,
  ) {}

  /**
   * Generate the ALM report PDF for a job on demand and return both the
   * binary buffer and the manifest describing it.
   */
  async generateAlmReportExport(
    userId: string,
    jobId: string,
    language: 'en' | 'es' = 'es',
  ): Promise<GeneratedDocumentExport> {
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    if (!job.institutionId) {
      throw new BadRequestException('No institution linked to this job');
    }
    if (job.status !== 'COMPLETE' && job.triggeredBy !== 'demo_provision') {
      throw new BadRequestException(
        `ALM report can only be regenerated for completed jobs (current: ${job.status})`,
      );
    }

    const institution = await this.almEnterprise.getInstitution(
      job.institutionId,
    );

    const watermark = this.deriveWatermark(job.triggeredBy);

    this.logger.log({
      event: 'portal.alm_report.generated_on_demand',
      jobId,
      userId,
      language,
      triggeredBy: job.triggeredBy,
    });

    const { buffer } = await this.reports.generateAndRecordArtifact(
      job.institutionId,
      {
        language,
        watermark: watermark ?? undefined,
        reportJobId: job.id,
        storageLocator: this.buildDownloadUrl(jobId, language),
        generatedBy: userId,
      },
    );

    return {
      manifest: createPdfManifest({
        id: buildManifestId('alm_report', jobId, language),
        kind: 'alm_report',
        language,
        audience: 'internal',
        status: 'ready',
        downloadUrl: this.buildDownloadUrl(jobId, language),
        sourceInstitutionId: job.institutionId,
        sourceJobId: job.id,
        institutionName: institution.name || job.institutionName,
        generatedAt: job.completedAt || new Date(),
        watermark: watermark || null,
      }),
      buffer,
    };
  }

  /**
   * Build the public download URL the portal manifest exposes for the
   * on-demand endpoint. Always relative — the frontend prepends the API base.
   */
  buildDownloadUrl(jobId: string, language: 'en' | 'es'): string {
    return `/api/portal/jobs/${jobId}/alm-report?lang=${language}`;
  }

  /**
   * Demo-provisioned jobs surface a provenance line as their watermark so
   * recipients always see "Built from public filings" on every page.
   */
  private deriveWatermark(
    triggeredBy: string | null | undefined,
  ): string | null {
    if (triggeredBy === 'demo_provision') {
      return 'PRELIMINARY — Built from public filings (COSSEC / NCUA)';
    }
    return null;
  }

  /**
   * Manifest stub used by listJobExports to surface alm_report cards in
   * the UI without paying the cost of regenerating the PDF.
   */
  buildManifestStub(params: {
    jobId: string;
    institutionId: string | null;
    institutionName: string;
    language: 'en' | 'es';
    generatedAt: Date | null;
    expiresAt: Date | null;
    triggeredBy: string | null | undefined;
  }): DocumentExportManifest {
    return createPdfManifest({
      id: buildManifestId('alm_report', params.jobId, params.language),
      kind: 'alm_report',
      language: params.language,
      audience: 'internal',
      status: 'ready',
      downloadUrl: this.buildDownloadUrl(params.jobId, params.language),
      sourceInstitutionId: params.institutionId,
      sourceJobId: params.jobId,
      institutionName: params.institutionName,
      generatedAt: params.generatedAt,
      expiresAt: params.expiresAt,
      watermark: this.deriveWatermark(params.triggeredBy),
    });
  }
}
