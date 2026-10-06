import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SampleReportService } from './sample-report.service';
import { SampleReportQueueService } from './sample-report-queue.service';
import { PreviewTokenQuerySchema, parseOrThrow } from './cossec.dto';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// Mixed controller: 3 admin routes (`admin/api/sample-reports/*`) plus
// 1 public preview route (`api/demo/preview`). Method-level
// `@UseGuards(AdminKeyGuard)` on the 3 admin handlers — class-level
// would gate the public preview surface. AuthModule is `@Global()`
// (peer `6b317c44`) so no module import is needed.

@Controller()
export class SampleReportController {
  private readonly logger = new Logger(SampleReportController.name);

  constructor(
    private readonly sampleReportService: SampleReportService,
    private readonly queueService: SampleReportQueueService,
  ) {}

  // ── POST /admin/api/sample-reports/generate-all ──────────────────────────

  /**
   * Trigger batch generation of sample reports for all prospects.
   * Admin only. Enqueues all un-generated prospects into the queue.
   */
  @Post('admin/api/sample-reports/generate-all')
  @UseGuards(AdminKeyGuard)
  async generateAll() {
    this.logger.log('Batch sample report generation triggered');

    const result = await this.queueService.enqueueAllProspects();

    return {
      message: `Enqueued ${result.jobCount} prospects for report generation`,
      ...result,
    };
  }

  // ── POST /admin/api/sample-reports/generate/:prospectInstitutionId ──────

  /**
   * Generate a single sample report for a specific prospect.
   */
  @Post('admin/api/sample-reports/generate/:prospectInstitutionId')
  @UseGuards(AdminKeyGuard)
  async generateSingle(
    @Param('prospectInstitutionId') prospectInstitutionId: string,
  ) {
    if (!prospectInstitutionId) {
      throw new BadRequestException('prospectInstitutionId is required');
    }

    this.logger.log(
      `Single sample report generation triggered for ${prospectInstitutionId}`,
    );

    const result = await this.sampleReportService.generateSampleReport(
      prospectInstitutionId,
    );

    return {
      message: 'Sample report generated',
      ...result,
    };
  }

  // ── GET /admin/api/sample-reports/status ─────────────────────────────────

  /**
   * Get the current queue status for sample report generation.
   */
  @Get('admin/api/sample-reports/status')
  @UseGuards(AdminKeyGuard)
  async getQueueStatus() {
    const status = this.queueService.getQueueStatus();

    return {
      message: 'Queue status',
      ...status,
    };
  }

  // ── GET /api/demo/preview ────────────────────────────────────────────────

  /**
   * Public endpoint: preview a sample report using a JWT token.
   * No admin key required — the JWT itself is the auth mechanism.
   */
  @Get('api/demo/preview')
  async previewReport(@Query() query: unknown) {
    let params;
    try {
      params = parseOrThrow(PreviewTokenQuerySchema, query);
    } catch (err) {
      throw new BadRequestException('Missing or invalid preview token');
    }

    const result = await this.sampleReportService.validatePreviewToken(
      params.token,
    );

    if (!result) {
      throw new UnauthorizedException('Invalid or expired preview token');
    }

    // Fetch the full prospect data for rendering
    return {
      valid: true,
      prospectInstitutionId: result.prospectInstitutionId,
      institutionName: result.institutionName,
      previewUrl: `/api/demo/preview?institution=${result.prospectInstitutionId}`,
    };
  }
}
