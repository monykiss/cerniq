import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  Logger,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import { CSVIngestionService } from '../alm/csv-ingestion.service';
import {
  CsvSchemaInferenceService,
  type ResolutionInput,
} from '../alm/csv-schema-inference.service';
import { EmailService } from '../email/email.service';
import { IngestionLogsService } from '../alm/ingestion-logs.service';
import { DataCryptoService } from '../crypto/data-crypto.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { SkipAuditLog } from '../common/decorators/audit-action.decorator';
import { PlatformAccessService } from '../auth/platform-access.service';
import {
  PortalDocumentExportsService,
  type PortalJobExportSummary,
} from './portal-document-exports.service';
import { PortalAlmReportService } from './portal-alm-report.service';
import { DemoSeatService } from './demo-seat.service';
import { ReportStorageService } from '../pipeline/report-storage.service';
import { buildPdfResponseHeaders } from '../alm/document-exports.util';

type PortalWorkflowState =
  | 'needs_report'
  | 'needs_upload'
  | 'validation_failed'
  | 'processing'
  | 'export_degraded'
  | 'report_ready';

type PortalValidationIssue = {
  row?: number | null;
  field?: string | null;
  message: string;
};

type PortalValidationSummary = {
  sourceFilename: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedCount: number;
  warningCount: number;
  errorCount: number;
  warnings: string[];
  errors: PortalValidationIssue[];
};

const PORTAL_PROCESSING_STATUSES = [
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'GENERATING_PDF',
  'UPLOADING',
] as const;

const PORTAL_ACTIONABLE_STATUSES = [
  'AWAITING_DATA',
  'VALIDATION_FAILED',
  ...PORTAL_PROCESSING_STATUSES,
  'COMPLETE',
] as const;

type PortalOverviewJob = {
  id: string;
  institutionId: string | null;
  institutionName: string;
  status: string;
  analysisPeriod: string | null;
  previousJobId: string | null;
  submittedAt: Date | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  reportUrl: string | null;
  reportUrlEn: string | null;
  reportLang: string;
  errorMessage: string | null;
  userId: string;
  triggeredBy: string;
  exportSummary: PortalJobExportSummary | null;
};

type PortalSettingsPermissions = {
  canManageWorkspace: boolean;
  canManageSeats: boolean;
  canManageApiKeys: boolean;
  canManageBilling: boolean;
};

class InviteDto {
  @IsEmail()
  email: string;

  @IsIn(['OWNER', 'ANALYST', 'VIEWER'])
  role: 'OWNER' | 'ANALYST' | 'VIEWER';

  @IsOptional()
  @IsString()
  name?: string;
}

@ApiTags('Client Portal')
@ApiBearerAuth('BearerAuth')
@Controller('api/portal')
@UseGuards(AuthGuard, RolesGuard)
export class PortalController {
  private readonly logger = new Logger(PortalController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly csvIngestion: CSVIngestionService,
    private readonly schemaInference: CsvSchemaInferenceService,
    private readonly ingestionLogs: IngestionLogsService,
    private readonly email: EmailService,
    private readonly dataCrypto: DataCryptoService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly platformAccess: PlatformAccessService,
    private readonly portalExports: PortalDocumentExportsService,
    private readonly portalAlmReport: PortalAlmReportService,
    private readonly demoSeats: DemoSeatService,
    private readonly reportStorage: ReportStorageService,
  ) {}

  // ── List User's Report Jobs ─────────────────────────
  // All roles can view report jobs

  @Get('jobs')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({ summary: 'List all report jobs for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Array of report jobs with status and metadata',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Paid subscription required' })
  async listJobs(@Req() req: any) {
    const userId = req.user.userId;
    const scope = await this.buildJobOwnerScope(userId);

    return this.loadPortalJobs(scope);
  }

  @Get('overview')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary:
      'Get canonical portal workflow overview for the authenticated user',
  })
  async getOverview(@Req() req: any) {
    const userId = req.user.userId;
    const scope = await this.buildJobOwnerScope(userId);
    const jobs = await this.loadPortalJobs(scope);
    const counts = this.countPortalJobs(jobs);
    const latestActionableJob = this.selectLatestActionableJob(jobs);
    const workflowState = this.derivePortalWorkflowState(latestActionableJob);
    const validationSummary = latestActionableJob
      ? await this.getValidationSummaryForJob(
          latestActionableJob.userId,
          latestActionableJob.id,
        )
      : null;

    return {
      jobs,
      latestActionableJob,
      workflowState,
      counts,
      demoSeat: await this.loadDemoSeatContextPayload(userId),
      nextAction: this.buildNextAction(workflowState, latestActionableJob),
      validationSummary,
    };
  }

  @Post('jobs/open-cycle')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary:
      'Create or reuse the current actionable report cycle for the authenticated user',
  })
  async openReportCycle(
    @Req() req: any,
    @Body()
    body: {
      institutionName?: string;
      institutionType?: string;
      primaryRegulator?: 'COSSEC' | 'NCUA';
      preferredLanguage?: 'en' | 'es' | 'both';
      totalAssets?: number | string;
    } = {},
  ) {
    const userId = req.user.userId;
    await this.requirePaidPortalAccess(userId);

    const actionableJob = await this.prisma.reportJob.findFirst({
      where: {
        userId,
        status: {
          in: ['AWAITING_DATA', 'VALIDATION_FAILED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (actionableJob) {
      return this.buildCycleResponse(actionableJob);
    }

    const institution =
      (await this.findLatestInstitutionForUser(userId)) ||
      (await this.ensureInstitutionForUser(userId, body));

    const createdJob = await this.prisma.reportJob.create({
      data: {
        userId,
        institutionId: institution?.id || null,
        institutionName:
          institution?.name ||
          body.institutionName?.trim() ||
          'Pending Institution',
        reportLang:
          institution?.preferredLanguage || body.preferredLanguage || 'es',
        status: 'AWAITING_DATA',
        triggeredBy: 'portal_cycle_bootstrap',
      },
    });

    return this.buildCycleResponse(createdJob);
  }

  // ── Get Job Detail ──────────────────────────────────
  // All roles can view job details (report download)

  @Get('jobs/:jobId')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({ summary: 'Get report job details including download URLs' })
  @ApiParam({ name: 'jobId', description: 'Report job UUID' })
  @ApiResponse({ status: 200, description: 'Report job details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJob(@Req() req: any, @Param('jobId') jobId: string) {
    const scope = await this.buildJobOwnerScope(req.user.userId);

    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, ...scope },
    });
    if (!job) throw new NotFoundException('Job not found');

    // Audit log for report access/download
    if (job.reportUrl || job.reportUrlEn) {
      this.audit.log({
        userId: req.user.userId,
        institutionId: job.institutionId || undefined,
        action: 'report_download',
        resource: 'report_job',
        resourceId: jobId,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
        metadata: scope.userId
          ? undefined
          : { platformAdminBypass: true, jobOwnerId: job.userId },
      });
    }

    return {
      ...job,
      exportSummary: this.portalExports.summarizeJobExportsForRecord(job),
    };
  }

  @Get('jobs/:jobId/ingestion-logs')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  async getJobIngestionLogs(@Req() req: any, @Param('jobId') jobId: string) {
    const scope = await this.buildJobOwnerScope(req.user.userId);
    // For platform admin bypass, look up the job's true owner so the ingestion-logs
    // service can scope correctly. Normal users always pass their own id.
    const ownerId = scope.userId || (await this.resolveJobOwner(jobId));
    return this.ingestionLogs.listJobLogs(ownerId, jobId);
  }

  @Get('jobs/:jobId/exports')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({ summary: 'List document export manifests for a report job' })
  async listJobExports(@Req() req: any, @Param('jobId') jobId: string) {
    const scope = await this.buildJobOwnerScope(req.user.userId);
    const ownerId = scope.userId || (await this.resolveJobOwner(jobId));
    return this.portalExports.listJobExports(ownerId, jobId);
  }

  // ── ALCO Meeting Pack (8-page board-ready PDF) ──────
  // All roles can generate ALCO packs for completed jobs

  @Get('jobs/:jobId/alco-pack')
  @SkipAuditLog()
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary: 'Download an 8-page board-ready ALCO meeting pack PDF',
  })
  @ApiParam({ name: 'jobId', description: 'Completed report job UUID' })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Language (en or es, default: es)',
  })
  @ApiResponse({
    status: 200,
    description: 'ALCO pack PDF binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({
    status: 400,
    description: 'Job not complete or no institution linked',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async downloadAlcoPack(
    @Req() req: any,
    @Res() res: any,
    @Param('jobId') jobId: string,
    @Query('lang') lang?: string,
  ) {
    return this.streamAlcoPackDocument(req, res, jobId, lang);
  }

  @Post('jobs/:jobId/alco-pack')
  @SkipAuditLog()
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary: 'Generate an 8-page board-ready ALCO meeting pack PDF',
  })
  @ApiParam({ name: 'jobId', description: 'Completed report job UUID' })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Language (en or es, default: es)',
  })
  @ApiResponse({
    status: 201,
    description: 'ALCO pack PDF binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({
    status: 400,
    description: 'Job not complete or no institution linked',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async generateAlcoPack(
    @Req() req: any,
    @Res() res: any,
    @Param('jobId') jobId: string,
    @Query('lang') lang?: string,
  ) {
    return this.streamAlcoPackDocument(req, res, jobId, lang);
  }

  private async streamAlcoPackDocument(
    req: any,
    res: any,
    jobId: string,
    lang?: string,
  ) {
    const userId = req.user.userId;
    const scope = await this.buildJobOwnerScope(userId);
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, ...scope },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'COMPLETE') {
      throw new BadRequestException(
        `ALCO pack can only be generated for completed reports (current: ${job.status})`,
      );
    }
    if (!job.institutionId) {
      throw new BadRequestException('No institution linked to this job');
    }

    const language = lang === 'en' ? 'en' : 'es';
    const document = await this.portalExports.generateAlcoPackExport(
      job.userId,
      jobId,
      language,
    );

    this.audit.log({
      userId,
      institutionId: job.institutionId,
      action: 'alco_pack_download',
      resource: 'report_job',
      resourceId: jobId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      metadata: scope.userId
        ? undefined
        : { platformAdminBypass: true, jobOwnerId: job.userId },
    });

    this.logger.log({
      event: 'portal.alco_pack.generated',
      jobId,
      userId,
      language,
    });

    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  // ── ALM Report (on-demand streaming PDF) ────────────
  // Used by demo seats (no R2 storage) and as a fallback when the
  // pipeline-uploaded URL is missing or relative. Re-runs the ALM engine
  // and Monte Carlo on every request — costlier than R2 but always fresh
  // and always available.

  @Get('jobs/:jobId/alm-report')
  @SkipAuditLog()
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary: 'Stream the ALM report PDF for a job, generated on demand',
  })
  @ApiParam({ name: 'jobId', description: 'Report job UUID' })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Language (en or es, default: es)',
  })
  @ApiResponse({
    status: 200,
    description: 'ALM report PDF binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async streamAlmReport(
    @Req() req: any,
    @Res() res: any,
    @Param('jobId') jobId: string,
    @Query('lang') lang?: string,
  ) {
    const userId = req.user.userId;
    const scope = await this.buildJobOwnerScope(userId);
    const ownerId = scope.userId || (await this.resolveJobOwner(jobId));

    const language = lang === 'en' ? 'en' : 'es';
    const document = await this.portalAlmReport.generateAlmReportExport(
      ownerId,
      jobId,
      language,
    );

    // Mark engagement on the prospect record (the actual demo user, not the platform admin).
    void this.demoSeats.markViewed(ownerId);

    this.audit.log({
      userId,
      action: 'alm_report_download',
      resource: 'report_job',
      resourceId: jobId,
      metadata: {
        language,
        onDemand: true,
        ...(scope.userId
          ? {}
          : { platformAdminBypass: true, jobOwnerId: ownerId }),
      },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  // ── Demo Seat Context (portal home banner) ──────────
  // Returns provenance, expiry, and refresh state for the current user's
  // demo seat (if any). Returns null for non-demo users. Platform admin can
  // pass ?asUserId= to view any specific demo seat without leaving their
  // own session.

  @Get('demo-seat')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary: 'Get demo-seat context for the authenticated user (or null)',
  })
  async getDemoSeatContext(
    @Req() req: any,
    @Query('asUserId') asUserId?: string,
  ) {
    const callerId = req.user.userId;
    const callerAccess = await this.platformAccess.getAccessForUser(callerId);

    // Platform admin impersonation: ?asUserId= lets them view any specific seat
    let targetUserId = callerId;
    if (asUserId && callerAccess.isPlatformAdmin) {
      targetUserId = asUserId;
    }

    const targetAccess =
      targetUserId === callerId
        ? callerAccess
        : await this.platformAccess.getAccessForUser(targetUserId);

    if (!targetAccess.isDemo) {
      return { isDemo: false, seat: null };
    }

    const seat = await this.demoSeats.getDemoSeatForUser(targetUserId);
    // Platform admin views don't count as the prospect viewing their own report
    if (targetUserId === callerId) {
      void this.demoSeats.markViewed(callerId);
    }

    return {
      isDemo: true,
      daysRemaining: targetAccess.daysRemaining,
      expiresAt: targetAccess.effectivePeriodEnd,
      viewedAsAdmin: targetUserId !== callerId,
      seat: seat
        ? {
            prospectId: seat.id,
            institutionName: seat.name,
            publicDataSource: seat.publicDataSource,
            provisionedAt: seat.demoProvisionedAt?.toISOString() || null,
            expiresAt: seat.demoExpiresAt?.toISOString() || null,
            reportJobId: seat.demoReportJobId,
          }
        : null,
    };
  }

  /**
   * Look up the owner userId of a report job. Used by platform admin bypass
   * paths to forward the correct ownerId to downstream services that
   * still scope by user. Throws NotFoundException if the job doesn't exist.
   */
  private async resolveJobOwner(jobId: string): Promise<string> {
    const job = await this.prisma.reportJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return job.userId;
  }

  // ── Submit Data for a Job ───────────────────────────
  // Only OWNER and ANALYST can upload/submit data

  @Post('jobs/:jobId/submit')
  @SkipAuditLog()
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({ summary: 'Submit balance sheet CSV data for a report job' })
  @ApiParam({ name: 'jobId', description: 'Report job UUID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV file with balance sheet data',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        institutionName: { type: 'string' },
        analysisPeriod: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Data submitted and job queued for processing',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or job not awaiting data',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.csv$/i)) {
          return cb(
            new BadRequestException('Only .csv files are accepted'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async submitData(
    @Req() req: any,
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      institutionName?: string;
      institutionType?: string;
      primaryRegulator?: 'COSSEC' | 'NCUA';
      preferredLanguage?: 'en' | 'es' | 'both';
      totalAssets?: number | string;
      analysisPeriod?: string;
      /** JSON answers to a prior NEEDS_INPUT response (multipart carries strings). */
      importMapping?: string;
    },
  ) {
    const userId = req.user.userId;
    await this.requirePaidPortalAccess(userId);

    // Verify job belongs to user and is awaiting data
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (!['AWAITING_DATA', 'VALIDATION_FAILED'].includes(job.status)) {
      throw new BadRequestException(
        `Job is not ready for data submission (current: ${job.status})`,
      );
    }
    if (!file) throw new BadRequestException('No CSV file provided');

    // Parse and validate CSV
    const csvContent = file.buffer.toString('utf-8');

    // What actually landed in the buffer, recorded on EVERY submit.
    //
    // A 3.4 KB / 41-line template arriving as "1 non-empty line" is a transport
    // symptom, not a CSV problem, and the validator alone cannot tell the two
    // apart — it only ever sees the string. Measuring the bytes and separators
    // at the boundary is what distinguishes "the member sent a bad file" from
    // "the body was truncated before it reached us", which are opposite fixes.
    const receivedBytes = file.buffer.length;
    const newlineCount = (csvContent.match(/\n/g) || []).length;
    const carriageReturnCount = (csvContent.match(/\r/g) || []).length;
    this.logger.log({
      event: 'portal.upload_received',
      jobId,
      filename: file.originalname,
      declaredSize: file.size,
      receivedBytes,
      newlineCount,
      carriageReturnCount,
      encoding: file.encoding,
      mimetype: file.mimetype,
      // Enough to identify truncation without logging member data.
      head: csvContent.slice(0, 120),
    });

    let parseResult = this.csvIngestion.parseCSV(csvContent);

    // ── Dynamic ingestion fallback ───────────────────────────────────
    // The strict parser demands an exact header set. Real cooperativa exports
    // rarely match it (semicolon-delimited Spanish Excel, title rows above the
    // header, `Saldo` instead of `balance`, `1.234,56` instead of `1234.56`),
    // and every one of those used to hard-fail. When the strict pass fails, try
    // to understand the file instead of rejecting it: infer its shape, rewrite
    // it into the canonical form, and re-run the SAME validator so there is
    // still exactly one validation path.
    //
    // If the file cannot be read confidently we return the open questions
    // rather than a dead end — the importer asks, it never invents a value.
    const importNotes: string[] = [];
    if (!parseResult.valid) {
      const inference = this.schemaInference.infer(csvContent);
      const resolution = this.parseImportResolution(body.importMapping);

      if (inference.status !== 'unusable') {
        const converted = this.schemaInference.toCanonicalCsv(
          csvContent,
          inference,
          resolution,
        );

        if (converted) {
          const retried = this.csvIngestion.parseCSV(converted.csv);
          if (retried.valid) {
            parseResult = retried;
            importNotes.push(...inference.notes, ...converted.notes);
            this.logger.log(
              `Portal upload for job ${jobId} recovered by schema inference ` +
                `(delimiter=${inference.delimiterLabel}, headerRow=${inference.headerRowIndex}, rows=${retried.summary.validRows})`,
            );
          }
        }
      }

      // Still unusable: hand back the questions so the UI can ask them.
      if (!parseResult.valid && inference.questions.length > 0) {
        await this.prisma.reportJob.update({
          where: { id: jobId },
          data: { status: 'AWAITING_DATA' },
        });

        return {
          valid: false,
          status: 'NEEDS_INPUT',
          jobId,
          institutionId: job.institutionId,
          institutionName: job.institutionName,
          inference: {
            delimiter: inference.delimiterLabel,
            headerRowIndex: inference.headerRowIndex,
            skippedPreambleRows: inference.skippedPreambleRows,
            sourceHeaders: inference.sourceHeaders,
            detectedColumns: inference.columns,
            dataRowCount: inference.dataRowCount,
            sampleRows: inference.sampleRows,
            notes: inference.notes,
          },
          questions: inference.questions,
          errors: inference.unusableReason
            ? [{ message: inference.unusableReason }]
            : [],
          warnings: inference.notes,
          nextHref: `/portal/submit?jobId=${jobId}`,
        };
      }
    }

    if (!parseResult.valid) {
      await this.ingestionLogs.recordLog({
        userId,
        institutionId: job.institutionId || null,
        reportJobId: jobId,
        source: 'portal_submit',
        sourceFilename: file.originalname,
        status: 'FAILED',
        parseResult,
      });
      await this.prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: 'VALIDATION_FAILED',
          errorMessage: this.formatValidationErrors(parseResult.errors),
        },
      });
      return {
        valid: false,
        errors: parseResult.errors,
        warnings: parseResult.warnings,
        warningCount: parseResult.warnings.length,
        status: 'VALIDATION_FAILED',
        jobId,
        institutionId: job.institutionId,
        institutionName: job.institutionName,
        nextHref: `/portal/submit?jobId=${jobId}`,
      };
    }

    // Transition to VALIDATING
    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: { status: 'VALIDATING', submittedAt: new Date() },
    });

    // Create or find institution
    const instName = body.institutionName || job.institutionName || 'Unknown';
    let institution;
    if (job.institutionId) {
      institution = await this.almEnterprise.getInstitution(job.institutionId);
    } else {
      institution = await this.ensureInstitutionForUser(userId, {
        institutionName: instName,
        institutionType: body.institutionType,
        primaryRegulator: body.primaryRegulator,
        preferredLanguage: body.preferredLanguage,
        totalAssets:
          this.normalizeTotalAssets(body.totalAssets) ||
          parseResult.summary?.totalAssets ||
          0,
      });
    }

    // Import balance sheet items
    await this.almEnterprise.importBalanceSheetItems(
      institution.id,
      parseResult.items,
    );
    const log = await this.ingestionLogs.recordLog({
      userId,
      institutionId: institution.id,
      reportJobId: jobId,
      source: 'portal_submit',
      sourceFilename: file.originalname,
      status: 'IMPORTED',
      parseResult,
      importedCount: parseResult.items.length,
    });

    // Encrypt raw CSV data (AES-256-GCM) for audit trail; auto-purged after 90 days
    const encryptedRawData = this.dataCrypto.encrypt(csvContent);

    // ── Multi-period linking: find most recent COMPLETE job for same institution ──
    let previousJobId: string | null = null;
    try {
      const previousJob = await this.prisma.reportJob.findFirst({
        where: {
          institutionId: institution.id,
          status: 'COMPLETE',
          id: { not: jobId },
        },
        orderBy: { completedAt: 'desc' },
        select: { id: true },
      });
      if (previousJob) {
        previousJobId = previousJob.id;
      }
    } catch {
      // Gracefully ignore — column may not exist yet on older schemas
      this.logger.warn({ event: 'portal.previous_job_lookup_failed', jobId });
    }

    // Link institution and transition to QUEUED
    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: 'QUEUED',
        institutionId: institution.id,
        institutionName: instName,
        rawData: encryptedRawData,
        analysisPeriod: body.analysisPeriod || null,
        previousJobId,
        errorMessage: null,
      },
    });

    // Send acknowledgment email
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.email) {
      await this.email.sendDataSubmissionAck({
        email: user.email,
        name: user.name || '',
        institutionName: instName,
      });
    }

    this.logger.log({
      event: 'portal.data_submitted',
      jobId,
      userId,
      items: parseResult.items.length,
    });

    this.audit.log({
      userId,
      institutionId: institution.id,
      action: 'data_upload',
      resource: 'report_job',
      resourceId: jobId,
      metadata: {
        filename: file.originalname,
        itemsImported: parseResult.items.length,
        ingestionLogId: log.id,
      },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return {
      valid: true,
      status: 'QUEUED',
      jobId,
      itemsImported: parseResult.items.length,
      warningCount: parseResult.warnings.length,
      // Every assumption schema inference applied travels with the response so
      // the UI can disclose it. A recovered import must never look identical to
      // one that matched the canonical template exactly.
      importNotes,
      autoMapped: importNotes.length > 0,
      institutionId: institution.id,
      institutionName: instName,
      ingestionLogId: log.id,
      nextHref: `/portal/reports/${jobId}`,
    };
  }

  // ── Invite Team Member ────────────────────────────────
  // Only OWNER can invite new users

  @Post('invite')
  @SkipAuditLog()
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Invite a team member to the portal via magic link email',
  })
  @ApiResponse({ status: 201, description: 'Invite sent successfully' })
  @ApiResponse({ status: 400, description: 'Email already registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only OWNER role can invite' })
  async inviteUser(@Req() req: any, @Body() dto: InviteDto) {
    const ownerId = req.user.userId;
    await this.requirePaidPortalAccess(ownerId);

    // Look up the inviting user to find their workspace
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      include: {
        workspaces: { take: 1, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    // Check if the email is already registered
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new BadRequestException(
        'A user with this email already exists. They can be reassigned a role directly.',
      );
    }

    // Create the invited user linked to the same workspace
    const invitedUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name || null,
        provider: 'magic_link',
        emailVerified: true,
        role: dto.role as any,
      },
    });

    // If owner has a workspace, link the invited user to it
    if (owner.workspaces.length > 0) {
      await this.prisma.workspace.create({
        data: {
          name: `${dto.name || dto.email.split('@')[0]}'s Workspace`,
          ownerId: invitedUser.id,
        },
      });
    }

    // Generate a magic link for the invited user
    const magicUrl = await this.billing.generateMagicLink(invitedUser.id, 72);

    // Send invite email
    await this.email.sendTeamInviteEmail({
      email: dto.email,
      name: dto.name || '',
      inviterName: owner.name || owner.email,
      role: dto.role,
      magicUrl,
    });

    this.logger.log({
      event: 'portal.user_invited',
      invitedEmail: dto.email,
      role: dto.role,
      invitedBy: ownerId,
    });

    this.audit.log({
      userId: ownerId,
      action: 'team_invite',
      resource: 'user',
      resourceId: invitedUser.id,
      metadata: {
        invitedEmail: dto.email,
        invitedRole: dto.role,
      },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return {
      id: invitedUser.id,
      email: invitedUser.email,
      role: invitedUser.role,
      invited: true,
    };
  }

  // ── Settings ────────────────────────────────────────
  // All paid portal roles can access settings; owner-only actions stay gated

  @Get('settings')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  async getSettings(@Req() req: any) {
    const userId = req.user.userId;
    const access = await this.requirePaidPortalAccess(userId);
    const permissions = this.buildSettingsPermissions(req, access);

    const [
      user,
      subscription,
      workspaces,
      totalReports,
      completedReports,
      inProgressReports,
      awaitingDataReports,
      activeApiKeys,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.subscription.findUnique({
        where: { userId },
        select: {
          tier: true,
          status: true,
          currentPeriodEnd: true,
          reportsUsed: true,
        },
      }),
      this.prisma.workspace.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reportJob.count({
        where: { userId },
      }),
      this.prisma.reportJob.count({
        where: { userId, status: 'COMPLETE' },
      }),
      this.prisma.reportJob.count({
        where: {
          userId,
          status: {
            in: [
              'QUEUED',
              'PROCESSING',
              'GENERATING_PDF',
              'UPLOADING',
              'VALIDATING',
            ],
          },
        },
      }),
      this.prisma.reportJob.count({
        where: {
          userId,
          status: {
            in: ['AWAITING_DATA', 'VALIDATION_FAILED'],
          },
        },
      }),
      this.prisma.apiKey.count({
        where: {
          userId,
          revokedAt: null,
        },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    const workspaceIds = workspaces.map((workspace: any) => workspace.id);
    const institutions =
      workspaceIds.length > 0
        ? await this.prisma.institution.findMany({
            where: {
              workspaceId: {
                in: workspaceIds,
              },
            },
            select: {
              id: true,
              name: true,
              type: true,
              totalAssets: true,
              preferredLanguage: true,
              updatedAt: true,
              workspaceId: true,
            },
            orderBy: { updatedAt: 'desc' },
          })
        : [];

    const totalInstitutionAssets = institutions.reduce(
      (sum: number, institution: any) => sum + Number(institution.totalAssets),
      0,
    );

    return {
      user: user
        ? {
            ...user,
            role: req.user?.access?.isPlatformAdmin ? 'OWNER' : user.role,
          }
        : user,
      permissions,
      subscription: subscription || { tier: 'free', status: 'active' },
      workspaceCount: workspaces.length,
      workspaces,
      reportMetrics: {
        total: totalReports,
        completed: completedReports,
        inProgress: inProgressReports,
        awaitingData: awaitingDataReports,
      },
      institutionMetrics: {
        total: institutions.length,
        totalAssets: totalInstitutionAssets,
      },
      institutions: institutions.slice(0, 6),
      apiKeyCount: activeApiKeys,
    };
  }

  // ── Analysis Data for Interactive Report Suite ────
  @Get('jobs/:jobId/analysis-data')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({
    summary:
      'Get structured analysis data for the interactive report suite display',
  })
  @ApiParam({ name: 'jobId', description: 'Report job UUID' })
  @ApiResponse({
    status: 200,
    description:
      'Structured analysis data with balance sheet, risk metrics, and compliance',
  })
  async getJobAnalysisData(@Req() req: any, @Param('jobId') jobId: string) {
    const userId = req.user.userId;
    const scope = await this.buildJobOwnerScope(userId);
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, ...scope },
    });
    if (!job) throw new NotFoundException('Job not found');

    this.audit.log({
      userId,
      institutionId: job.institutionId || undefined,
      action: 'analysis_data_view',
      resource: 'report_job',
      resourceId: jobId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      metadata: scope.userId
        ? undefined
        : { platformAdminBypass: true, jobOwnerId: job.userId },
    });

    if (!job.institutionId) {
      return {
        institution: null,
        balanceSheet: null,
        interestRateRisk: null,
        liquidity: null,
        compliance: null,
        analysisRun: null,
      };
    }

    const [
      institution,
      balanceSheetItems,
      scenarios,
      liquidityPos,
      analysisRun,
    ] = await Promise.all([
      this.prisma.institution.findUnique({
        where: { id: job.institutionId },
        select: {
          id: true,
          name: true,
          type: true,
          totalAssets: true,
          currency: true,
          reportingDate: true,
          cossecRegistrationNumber: true,
          preferredLanguage: true,
        },
      }),
      this.prisma.balanceSheetItem.findMany({
        where: { institutionId: job.institutionId },
        orderBy: [
          { category: 'asc' },
          { subcategory: 'asc' },
          { balance: 'desc' },
        ],
      }),
      this.prisma.interestRateScenario.findMany({
        where: { institutionId: job.institutionId },
        orderBy: { shiftBps: 'asc' },
      }),
      this.prisma.liquidityPosition.findFirst({
        where: { institutionId: job.institutionId },
        orderBy: { date: 'desc' },
      }),
      this.prisma.analysisRun.findFirst({
        where: {
          institutionId: job.institutionId,
          status: 'COMPLETED',
        },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          resultSummary: true,
          completedAt: true,
          modelVersion: true,
          analysisType: true,
          scenarioSet: true,
        },
      }),
    ]);

    const toNum = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object' && 'toNumber' in v)
        return (v as { toNumber(): number }).toNumber();
      return Number(v) || 0;
    };

    type BSItem = {
      category: string;
      subcategory: string;
      name: string;
      balance: number;
      rate: number;
      duration: number;
      rateType: string;
    };

    const items: BSItem[] = balanceSheetItems.map((item: any) => ({
      category: item.category as string,
      subcategory: item.subcategory as string,
      name: item.name as string,
      balance: toNum(item.balance),
      rate: toNum(item.rate),
      duration: toNum(item.duration),
      rateType: item.rateType as string,
    }));

    const assets = items.filter((i) => i.category === 'asset');
    const liabilities = items.filter((i) => i.category === 'liability');
    const equityItems = items.filter(
      (i) => i.subcategory === 'equity' || i.category === 'equity',
    );

    const totalAssets = assets.reduce((s, i) => s + Number(i.balance), 0);
    const totalLiabilities = liabilities.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );
    const totalEquity =
      equityItems.length > 0
        ? equityItems.reduce((s, i) => s + Number(i.balance), 0)
        : totalAssets - totalLiabilities;

    const weightedAssetDuration =
      totalAssets > 0
        ? assets.reduce((s, i) => s + i.duration * i.balance, 0) / totalAssets
        : 0;
    const weightedLiabilityDuration =
      totalLiabilities > 0
        ? liabilities.reduce((s, i) => s + i.duration * i.balance, 0) /
          totalLiabilities
        : 0;
    const durationGap = weightedAssetDuration - weightedLiabilityDuration;

    const weightedAssetYield =
      totalAssets > 0
        ? assets.reduce((s, i) => s + i.rate * i.balance, 0) / totalAssets
        : 0;
    const weightedLiabilityCost =
      totalLiabilities > 0
        ? liabilities.reduce((s, i) => s + i.rate * i.balance, 0) /
          totalLiabilities
        : 0;
    const nim = weightedAssetYield - weightedLiabilityCost;

    const loanItems = assets.filter((i) => i.subcategory === 'loans');
    const depositItems = liabilities.filter(
      (i) => i.subcategory === 'deposits',
    );
    const totalLoans = loanItems.reduce((s, i) => s + Number(i.balance), 0);
    const totalDeposits = depositItems.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );
    const loanToDeposit = totalDeposits > 0 ? totalLoans / totalDeposits : 0;

    const capitalAdequacy = totalAssets > 0 ? totalEquity / totalAssets : 0;

    const lcr = liquidityPos ? toNum(liquidityPos.lcr) : null;
    const nsfr = liquidityPos ? toNum(liquidityPos.nsfr) : null;

    const complianceRatios = [
      {
        id: 'capital_adequacy',
        nameEn: 'Capital Adequacy',
        nameEs: 'Adecuación de Capital',
        value: capitalAdequacy,
        threshold: 0.08,
        sectorMedian: 0.092,
        format: 'percent',
      },
      {
        id: 'duration_gap',
        nameEn: 'Duration Gap',
        nameEs: 'Brecha de Duración',
        value: durationGap,
        thresholdLow: -1,
        thresholdHigh: 3,
        sectorMedian: 1.8,
        format: 'years',
      },
      {
        id: 'nim',
        nameEn: 'Net Interest Margin',
        nameEs: 'Margen de Interés Neto',
        value: nim,
        threshold: 0.025,
        sectorMedian: 0.029,
        format: 'percent',
      },
      {
        id: 'loan_to_deposit',
        nameEn: 'Loan-to-Deposit Ratio',
        nameEs: 'Razón Préstamos/Depósitos',
        value: loanToDeposit,
        threshold: 0.8,
        sectorMedian: 0.783,
        format: 'percent',
      },
      {
        id: 'earning_asset_yield',
        nameEn: 'Earning Asset Yield',
        nameEs: 'Rendimiento de Activos Productivos',
        value: weightedAssetYield,
        threshold: 0.035,
        sectorMedian: 0.048,
        format: 'percent',
      },
      {
        id: 'cost_of_funds',
        nameEn: 'Cost of Funds',
        nameEs: 'Costo de Fondos',
        value: weightedLiabilityCost,
        threshold: 0.03,
        sectorMedian: 0.019,
        format: 'percent',
        invertThreshold: true,
      },
      ...(lcr !== null
        ? [
            {
              id: 'lcr',
              nameEn: 'Liquidity Coverage Ratio',
              nameEs: 'Razón de Cobertura de Liquidez',
              value: lcr,
              threshold: 1.0,
              sectorMedian: 1.18,
              format: 'percent',
            },
          ]
        : []),
      ...(nsfr !== null
        ? [
            {
              id: 'nsfr',
              nameEn: 'Net Stable Funding Ratio',
              nameEs: 'Razón de Financiamiento Estable Neto',
              value: nsfr,
              threshold: 1.0,
              sectorMedian: 1.12,
              format: 'percent',
            },
          ]
        : []),
    ];

    return {
      institution: institution
        ? {
            name: institution.name,
            type: institution.type,
            totalAssets: toNum(institution.totalAssets),
            currency: institution.currency || 'USD',
            reportingDate: institution.reportingDate,
            cossecNumber: institution.cossecRegistrationNumber,
          }
        : null,
      balanceSheet: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        items,
        assetBreakdown: this.groupBySubcategory(assets),
        liabilityBreakdown: this.groupBySubcategory(liabilities),
      },
      interestRateRisk: {
        durationGap,
        assetDuration: weightedAssetDuration,
        liabilityDuration: weightedLiabilityDuration,
        nim,
        earningAssetYield: weightedAssetYield,
        costOfFunds: weightedLiabilityCost,
        scenarios: scenarios.map((s: any) => ({
          name: s.name,
          shiftBps: s.shiftBps,
          niImpact: toNum(s.niImpact),
          mveImpact: toNum(s.mveImpact),
        })),
      },
      liquidity: liquidityPos
        ? {
            lcr: lcr!,
            nsfr: nsfr!,
            hqlaLevel1: toNum(liquidityPos.hqlaLevel1),
            hqlaLevel2: toNum(liquidityPos.hqlaLevel2),
            hqlaTotal:
              toNum(liquidityPos.hqlaLevel1) + toNum(liquidityPos.hqlaLevel2),
            cashOutflows: toNum(liquidityPos.cashOutflows),
            cashInflows: toNum(liquidityPos.cashInflows),
            loanToDeposit,
          }
        : null,
      compliance: { ratios: complianceRatios },
      analysisRun: analysisRun
        ? {
            resultSummary: analysisRun.resultSummary,
            completedAt: analysisRun.completedAt?.toISOString() || null,
            modelVersion: analysisRun.modelVersion,
          }
        : null,
      jobMeta: {
        status: job.status,
        analysisPeriod: job.analysisPeriod,
        triggeredBy: job.triggeredBy,
        completedAt: job.completedAt?.toISOString() || null,
      },
    };
  }

  private groupBySubcategory(
    items: Array<{ subcategory: string; balance: number; name: string }>,
  ): Array<{ subcategory: string; total: number; count: number }> {
    const groups = new Map<string, { total: number; count: number }>();
    for (const item of items) {
      const existing = groups.get(item.subcategory) || {
        total: 0,
        count: 0,
      };
      existing.total += Number(item.balance);
      existing.count += 1;
      groups.set(item.subcategory, existing);
    }
    return Array.from(groups.entries()).map(([subcategory, data]) => ({
      subcategory,
      ...data,
    }));
  }

  private formatValidationErrors(
    errors: Array<{ row: number; field: string; message: string }>,
  ): string {
    return errors
      .slice(0, 5)
      .map((error) => `row ${error.row} ${error.field}: ${error.message}`)
      .join(' | ');
  }

  private buildCycleResponse(job: {
    id: string;
    institutionId?: string | null;
    institutionName?: string | null;
    status: string;
  }) {
    return {
      jobId: job.id,
      institutionId: job.institutionId || null,
      institutionName: job.institutionName || null,
      status: job.status,
      nextHref: `/portal/submit?jobId=${job.id}`,
    };
  }

  private normalizeTotalAssets(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = Number(value.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(normalized) ? normalized : 0;
    }
    return 0;
  }

  private async resolvePrimaryWorkspace(userId: string, fallbackName?: string) {
    const existingWorkspace = await this.prisma.workspace.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });

    if (existingWorkspace) {
      return existingWorkspace;
    }

    return this.prisma.workspace.create({
      data: {
        ownerId: userId,
        name: fallbackName?.trim() || 'My Institution',
      },
    });
  }

  private async findLatestInstitutionForUser(userId: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (workspaces.length === 0) {
      return null;
    }

    return this.prisma.institution.findFirst({
      where: {
        workspaceId: {
          in: workspaces.map((workspace: { id: string }) => workspace.id),
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async ensureInstitutionForUser(
    userId: string,
    input: {
      institutionName?: string;
      institutionType?: string;
      primaryRegulator?: 'COSSEC' | 'NCUA';
      preferredLanguage?: 'en' | 'es' | 'both';
      totalAssets?: number | string;
    },
  ) {
    const institutionName = input.institutionName?.trim();
    if (!institutionName) {
      return null;
    }

    const workspace = await this.resolvePrimaryWorkspace(
      userId,
      institutionName,
    );

    const existingInstitution = await this.prisma.institution.findFirst({
      where: {
        workspaceId: workspace.id,
        name: institutionName,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existingInstitution) {
      return existingInstitution;
    }

    return this.almEnterprise.createInstitution({
      workspaceId: workspace.id,
      name: institutionName,
      type: input.institutionType || 'cooperativa',
      totalAssets: this.normalizeTotalAssets(input.totalAssets),
      reportingDate: new Date().toISOString().slice(0, 10),
      primaryRegulator: input.primaryRegulator || 'COSSEC',
      preferredLanguage: input.preferredLanguage || 'es',
    });
  }

  /**
   * Decode the answers the user gave to a prior NEEDS_INPUT response.
   *
   * Multipart form fields are strings, so the mapping arrives JSON-encoded.
   * Malformed input is treated as "no answers given" rather than an exception:
   * the caller then re-asks the questions, which is a better outcome than a
   * 400 that loses the upload.
   */
  private parseImportResolution(raw?: string): ResolutionInput {
    if (!raw || typeof raw !== 'string') {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const record = parsed as {
        columnOverrides?: unknown;
        defaults?: unknown;
      };

      const resolution: ResolutionInput = {};

      if (
        record.columnOverrides &&
        typeof record.columnOverrides === 'object'
      ) {
        resolution.columnOverrides =
          record.columnOverrides as ResolutionInput['columnOverrides'];
      }
      if (record.defaults && typeof record.defaults === 'object') {
        resolution.defaults = record.defaults as ResolutionInput['defaults'];
      }

      return resolution;
    } catch (error) {
      this.logger.warn(
        `Ignoring malformed importMapping payload: ${
          error instanceof Error ? error.message : 'unparseable'
        }`,
      );
      return {};
    }
  }

  private async requirePaidPortalAccess(userId: string) {
    const access = await this.platformAccess.getAccessForUser(userId);
    if (!access.platformAccessAllowed) {
      throw new ForbiddenException(
        this.platformAccess.buildForbiddenPayload(access),
      );
    }
    return access;
  }

  private buildSettingsPermissions(
    req: any,
    access: Awaited<ReturnType<PortalController['requirePaidPortalAccess']>>,
  ): PortalSettingsPermissions {
    const normalizedRole =
      typeof req?.user?.role === 'string' ? req.user.role.toUpperCase() : '';
    const isOwner = access.isPlatformAdmin || normalizedRole === 'OWNER';

    return {
      canManageWorkspace: isOwner,
      canManageSeats: isOwner,
      canManageApiKeys: isOwner,
      canManageBilling: isOwner,
    };
  }

  private async loadPortalJobs(scope: {
    userId?: string;
  }): Promise<PortalOverviewJob[]> {
    const jobs: Array<Omit<PortalOverviewJob, 'exportSummary'>> =
      await this.prisma.reportJob.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: scope.userId ? undefined : 200,
        select: {
          id: true,
          institutionId: true,
          institutionName: true,
          status: true,
          analysisPeriod: true,
          previousJobId: true,
          submittedAt: true,
          processingStartedAt: true,
          completedAt: true,
          createdAt: true,
          reportUrl: true,
          reportUrlEn: true,
          reportLang: true,
          errorMessage: true,
          userId: true,
          triggeredBy: true,
        },
      });

    return jobs.map((job: Omit<PortalOverviewJob, 'exportSummary'>) => ({
      ...job,
      exportSummary: this.portalExports.summarizeJobExportsForRecord(job),
    }));
  }

  private countPortalJobs(jobs: PortalOverviewJob[]) {
    return jobs.reduce(
      (acc, job) => {
        acc.total += 1;
        if (job.status === 'AWAITING_DATA') acc.awaitingData += 1;
        if (job.status === 'VALIDATION_FAILED') acc.validationFailed += 1;
        if (PORTAL_PROCESSING_STATUSES.includes(job.status as any)) {
          acc.processing += 1;
        }
        if (job.status === 'COMPLETE') acc.complete += 1;
        return acc;
      },
      {
        total: 0,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 0,
      },
    );
  }

  private selectLatestActionableJob(
    jobs: PortalOverviewJob[],
  ): PortalOverviewJob | null {
    const priority: Record<string, number> = {
      VALIDATION_FAILED: 0,
      AWAITING_DATA: 1,
      VALIDATING: 2,
      QUEUED: 3,
      PROCESSING: 4,
      GENERATING_PDF: 5,
      UPLOADING: 6,
      COMPLETE: 7,
    };

    const actionable = jobs.filter((job) =>
      PORTAL_ACTIONABLE_STATUSES.includes(job.status as any),
    );
    if (actionable.length === 0) {
      return null;
    }

    return actionable.sort((left, right) => {
      const leftPriority = priority[left.status] ?? 99;
      const rightPriority = priority[right.status] ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    })[0];
  }

  private derivePortalWorkflowState(
    job: PortalOverviewJob | null,
  ): PortalWorkflowState {
    if (!job) {
      return 'needs_report';
    }
    if (job.status === 'VALIDATION_FAILED') {
      return 'validation_failed';
    }
    if (job.status === 'AWAITING_DATA') {
      return 'needs_upload';
    }
    if (PORTAL_PROCESSING_STATUSES.includes(job.status as any)) {
      return 'processing';
    }
    if (job.status === 'COMPLETE') {
      return job.exportSummary?.status === 'ready'
        ? 'report_ready'
        : 'export_degraded';
    }
    return 'needs_report';
  }

  private buildNextAction(
    workflowState: PortalWorkflowState,
    job: PortalOverviewJob | null,
  ) {
    switch (workflowState) {
      case 'validation_failed':
        return {
          labelEn: 'Fix validation and resubmit',
          labelEs: 'Corregir validacion y reenviar',
          href: job ? `/portal/submit?jobId=${job.id}` : '/portal/submit',
          jobId: job?.id ?? null,
          explanationEn:
            'This report needs corrected balance-sheet data before CERNIQ can continue.',
          explanationEs:
            'Este informe necesita datos corregidos antes de que CERNIQ pueda continuar.',
        };
      case 'needs_upload':
        return {
          labelEn: 'Upload balance-sheet data',
          labelEs: 'Cargar datos del balance',
          href: job ? `/portal/submit?jobId=${job.id}` : '/portal/submit',
          jobId: job?.id ?? null,
          explanationEn:
            'Your report cycle is waiting for the CSV needed to start validation and analysis.',
          explanationEs:
            'El ciclo de informe esta esperando el CSV para comenzar la validacion y el analisis.',
        };
      case 'processing':
        return {
          labelEn: 'Track processing',
          labelEs: 'Seguir procesamiento',
          href: job ? `/portal/reports/${job.id}` : '/portal',
          jobId: job?.id ?? null,
          explanationEn:
            'Your upload has been accepted and the report is moving through the CERNIQ pipeline.',
          explanationEs:
            'Su carga fue aceptada y el informe esta avanzando por la tuberia de CERNIQ.',
        };
      case 'export_degraded':
        return {
          labelEn: 'Review export availability',
          labelEs: 'Revisar disponibilidad de exportacion',
          href: job ? `/portal/reports/${job.id}` : '/portal',
          jobId: job?.id ?? null,
          explanationEn:
            'The report job finished, but one or more export files still need recovery before delivery is fully complete.',
          explanationEs:
            'El trabajo del informe termino, pero uno o mas archivos de exportacion todavia necesitan recuperarse antes de completar la entrega.',
        };
      case 'report_ready':
        return {
          labelEn: 'Open latest report',
          labelEs: 'Abrir ultimo informe',
          href: job ? `/portal/reports/${job.id}` : '/portal',
          jobId: job?.id ?? null,
          explanationEn:
            'Your latest report is ready to review, export, and share with stakeholders.',
          explanationEs:
            'Su ultimo informe esta listo para revisar, exportar y compartir.',
        };
      case 'needs_report':
      default:
        return {
          labelEn: 'Open workspace',
          labelEs: 'Abrir portal',
          href: '/portal',
          jobId: null,
          explanationEn:
            'Your account is active, but no report cycle is currently awaiting data.',
          explanationEs:
            'Su cuenta esta activa, pero no hay un ciclo de informe esperando datos.',
        };
    }
  }

  private async getValidationSummaryForJob(
    ownerId: string,
    jobId: string,
  ): Promise<PortalValidationSummary | null> {
    const log = await this.prisma.ingestionLog.findFirst({
      where: {
        reportJobId: jobId,
        createdByUserId: ownerId,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        sourceFilename: true,
        status: true,
        totalRows: true,
        validRows: true,
        errorRows: true,
        importedCount: true,
        warnings: true,
        errors: true,
      },
    });

    if (!log) {
      return null;
    }

    const warnings = Array.isArray(log.warnings)
      ? log.warnings.map((warning: unknown) => String(warning))
      : [];
    const errors = Array.isArray(log.errors)
      ? log.errors.map((error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'message' in error &&
            typeof (error as { message?: unknown }).message === 'string'
          ) {
            const issue = error as {
              row?: number | null;
              field?: string | null;
              message: string;
            };
            return {
              row: issue.row ?? null,
              field: issue.field ?? null,
              message: issue.message,
            };
          }

          return {
            row: null,
            field: null,
            message: String(error),
          };
        })
      : [];

    return {
      sourceFilename: log.sourceFilename,
      status: log.status,
      totalRows: log.totalRows,
      validRows: log.validRows,
      errorRows: log.errorRows,
      importedCount: log.importedCount,
      warningCount: warnings.length,
      errorCount: errors.length,
      warnings,
      errors,
    };
  }

  private async loadDemoSeatContextPayload(userId: string) {
    const access = await this.platformAccess.getAccessForUser(userId);
    if (!access.isDemo) {
      return { isDemo: false, seat: null };
    }

    const seat = await this.demoSeats.getDemoSeatForUser(userId);
    return {
      isDemo: true,
      daysRemaining: access.daysRemaining,
      expiresAt: access.effectivePeriodEnd,
      seat: seat
        ? {
            prospectId: seat.id,
            institutionName: seat.name,
            publicDataSource: seat.publicDataSource,
            provisionedAt: seat.demoProvisionedAt?.toISOString() || null,
            expiresAt: seat.demoExpiresAt?.toISOString() || null,
            reportJobId: seat.demoReportJobId,
          }
        : null,
    };
  }

  /**
   * Build the where-scope used by portal READ queries.
   *
   * - Normal users  → `{ userId }` (only their own jobs)
   * - Platform admin    → `{}`         (sees ALL jobs across the platform)
   *
   * Used for: listJobs, getJob, listJobExports, generateAlcoPack,
   * streamAlmReport, getJobIngestionLogs, getDemoSeatContext.
   *
   * Write endpoints (submitData, inviteUser) intentionally do NOT use this —
   * the platform admin has admin endpoints for those operations.
   */
  private async buildJobOwnerScope(
    userId: string,
  ): Promise<{ userId?: string }> {
    const access = await this.requirePaidPortalAccess(userId);
    if (access.isPlatformAdmin) {
      return {};
    }
    return { userId };
  }

  // ── Local PDF download (fallback when R2 is not configured) ──

  @Get('reports/download/:key')
  @Roles('OWNER', 'ANALYST', 'VIEWER')
  @ApiOperation({ summary: 'Download a report PDF from local buffer storage' })
  @ApiParam({ name: 'key', description: 'Report storage key (URL-encoded)' })
  async downloadLocalReport(
    @Req() req: any,
    @Res() res: any,
    @Param('key') key: string,
  ) {
    const userId = req.user.userId;
    await this.requirePaidPortalAccess(userId);

    // Key arrives URL-encoded from getSignedUrl (e.g. "reports%2Fjob_1%2Freport_es.pdf")
    const decodedKey = decodeURIComponent(key);
    const jobIdMatch = decodedKey.match(/^reports\/([^/]+)\//);
    if (!jobIdMatch) throw new NotFoundException('Invalid report key');

    const jobId = jobIdMatch[1];
    const job = await this.prisma.reportJob.findFirst({
      where: { id: jobId, userId, status: 'COMPLETE' },
    });
    if (!job) throw new NotFoundException('Report not found');

    const buffer = this.reportStorage.getLocalBuffer(decodedKey);
    if (!buffer) {
      // Fallback: if the job has a cloud-stored URL, redirect there instead of 404
      const isEn = decodedKey.includes('_en.pdf');
      const fallbackUrl = isEn ? job.reportUrlEn : job.reportUrl;
      if (fallbackUrl && fallbackUrl.startsWith('http')) {
        return res.redirect(302, fallbackUrl);
      }
      throw new NotFoundException(
        'Report buffer not available — it may have been evicted from memory. Please regenerate the report.',
      );
    }

    const lang = decodedKey.includes('_en.pdf') ? 'en' : 'es';
    const filename = `CERNIQ_ALM_Report_${job.institutionName?.replace(/[^a-zA-Z0-9]/g, '_') || 'Report'}_${lang.toUpperCase()}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buffer);
  }
}
