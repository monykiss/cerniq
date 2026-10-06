import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Logger,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ExamPrepScoringService } from './exam-prep-scoring.service';
import { EvidencePackageService } from './evidence-package.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import {
  InstitutionIdParamSchema,
  AssessBodySchema,
  EvidencePackageBodySchema,
  HistoryQuerySchema,
  parseOrThrow,
} from './exam-prep.dto';

/**
 * Exam Prep Controller — W3-4
 *
 * COSSEC regulatory exam readiness scoring and evidence package generation.
 * Provides bilingual (EN/ES) assessment results with A-F letter grades
 * across 12 weighted compliance categories.
 *
 * Class-level cross-tenant stack: AuthTenantGuard (auth + tenant resolution)
 * then InstitutionScopeGuard (ownership of `:institutionId`). Every route in
 * this controller carries `:institutionId`, so the ownership check fires on
 * all 5 endpoints.
 */
@Controller('api/exam-prep')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class ExamPrepController {
  private readonly logger = new Logger(ExamPrepController.name);

  constructor(
    private readonly scoringService: ExamPrepScoringService,
    private readonly evidenceService: EvidencePackageService,
  ) {}

  // ─── POST /api/exam-prep/:institutionId/assess ────────────────────────────

  @Post(':institutionId/assess')
  @HttpCode(HttpStatus.CREATED)
  async runAssessment(@Param() params: unknown, @Body() body: unknown) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);

    let dto;
    try {
      dto = parseOrThrow(AssessBodySchema, body ?? {});
    } catch (err: any) {
      throw new BadRequestException(err.issues ?? err.message);
    }

    this.logger.log({
      msg: 'Exam assessment requested',
      institutionId,
      assessedBy: dto.assessedBy,
    });

    const assessment = await this.scoringService.assessReadiness(
      institutionId,
      dto.assessedBy,
    );

    return {
      success: true,
      data: {
        assessmentId: assessment.id,
        institutionId: assessment.institutionId,
        overallScore: assessment.overallScore,
        letterGrade: assessment.letterGrade,
        assessedAt: assessment.assessedAt,
        assessedBy: assessment.assessedBy,
        summary: assessment.summary,
        summaryEs: assessment.summaryEs,
        passCount: assessment.passCount,
        warnCount: assessment.warnCount,
        failCount: assessment.failCount,
        categories: assessment.categories.map((c) => ({
          category: c.category,
          label: c.categoryLabel,
          labelEs: c.categoryLabelEs,
          score: c.score,
          weight: c.weight,
          weightedScore: Math.round(c.weightedScore * 10) / 10,
          compliance: c.compliance,
          value: c.value,
          unit: c.unit ?? null,
          remediation: c.remediation ?? null,
          remediationEs: c.remediationEs ?? null,
        })),
        remediationPlan: assessment.remediationPlan,
        remediationPlanEs: assessment.remediationPlanEs,
      },
    };
  }

  // ─── GET /api/exam-prep/:institutionId/latest ─────────────────────────────

  @Get(':institutionId/latest')
  async getLatestAssessment(@Param() params: unknown) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);

    const assessment =
      await this.scoringService.getLatestAssessment(institutionId);

    if (!assessment) {
      throw new NotFoundException(
        `No assessment found for institution ${institutionId}`,
      );
    }

    return {
      success: true,
      data: {
        assessmentId: assessment.id,
        overallScore: assessment.overallScore,
        letterGrade: assessment.letterGrade,
        assessedAt: assessment.assessedAt,
        passCount: assessment.passCount,
        warnCount: assessment.warnCount,
        failCount: assessment.failCount,
        summary: assessment.summary,
        summaryEs: assessment.summaryEs,
      },
    };
  }

  // ─── GET /api/exam-prep/:institutionId/history ────────────────────────────

  @Get(':institutionId/history')
  async getAssessmentHistory(
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);

    let dto;
    try {
      dto = parseOrThrow(HistoryQuerySchema, query ?? {});
    } catch (err: any) {
      throw new BadRequestException(err.issues ?? err.message);
    }

    const history =
      await this.scoringService.getAssessmentHistory(institutionId);

    return {
      success: true,
      count: Math.min(history.length, dto.limit),
      data: history.slice(0, dto.limit).map((a) => ({
        assessmentId: a.id,
        overallScore: a.overallScore,
        letterGrade: a.letterGrade,
        assessedAt: a.assessedAt,
        assessedBy: a.assessedBy,
        passCount: a.passCount,
        warnCount: a.warnCount,
        failCount: a.failCount,
      })),
    };
  }

  // ─── POST /api/exam-prep/:institutionId/evidence-package ──────────────────

  @Post(':institutionId/evidence-package')
  @HttpCode(HttpStatus.CREATED)
  async generateEvidencePackage(
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);

    let dto;
    try {
      dto = parseOrThrow(EvidencePackageBodySchema, body ?? {});
    } catch (err: any) {
      throw new BadRequestException(err.issues ?? err.message);
    }

    this.logger.log({
      msg: 'Evidence package generation requested',
      institutionId,
      format: dto.format,
      language: dto.language,
    });

    // Use the institutionId as the assessmentId for lookup
    const pkg =
      await this.evidenceService.generateEvidencePackage(institutionId);

    return {
      success: true,
      data: {
        packageId: pkg.packageId,
        institutionId: pkg.institutionId,
        fileCount: pkg.files.length,
        totalSizeBytes: pkg.sizeBytes,
        generatedAt: pkg.generatedAt,
        downloadUrl: pkg.downloadUrl,
        format: pkg.format,
        files: pkg.files.map((f) => ({
          name: f.name,
          description: f.description,
          descriptionEs: f.descriptionEs,
          type: f.type,
          sizeBytes: f.sizeBytes,
        })),
      },
    };
  }

  // ─── GET /api/exam-prep/:institutionId/evidence-package ───────────────────

  @Get(':institutionId/evidence-package')
  async getEvidencePackage(@Param() params: unknown) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);

    const pkg = await this.evidenceService.getPackage(institutionId);

    if (!pkg) {
      throw new NotFoundException(
        `No evidence package found for institution ${institutionId}. Generate one first via POST.`,
      );
    }

    return {
      success: true,
      data: {
        packageId: pkg.packageId,
        downloadUrl: pkg.downloadUrl,
        generatedAt: pkg.generatedAt,
        format: pkg.format,
        sizeBytes: pkg.sizeBytes,
        fileCount: pkg.files.length,
      },
    };
  }
}
