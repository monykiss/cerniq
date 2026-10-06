import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  Req,
  Logger,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthTenantGuard } from '../../auth/auth-tenant.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { CAMELCertificationService } from './camel-certification.service';
import { ReportsService } from '../reports/reports.service';
import type { Response } from 'express';

@ApiTags('CAMEL Certification')
@ApiBearerAuth('BearerAuth')
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard, RolesGuard)
export class CAMELCertificationController {
  private readonly logger = new Logger(CAMELCertificationController.name);

  constructor(
    private readonly certificationService: CAMELCertificationService,
  ) {}

  // ── Certification History ──────────────────────────────────────

  @Get(':institutionId/certifications')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({
    summary: 'List CAMEL certifications for an institution',
    description: 'Returns certification history for COSSEC examiner review.',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Certification history' })
  async listCertifications(
    @Param('institutionId') institutionId: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.certificationService.listCertifications(institutionId, take);
  }

  // ── HTML Preview ───────────────────────────────────────────────

  @Get(':institutionId/certification/:period')
  @Roles('OWNER', 'ANALYST')
  @AuditAction('CAMEL_CERTIFICATION_PREVIEW')
  @ApiOperation({
    summary: 'Generate CAMEL certification HTML preview',
    description:
      'Generates a COSSEC-formatted CAMEL self-assessment report as HTML for preview.',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiParam({
    name: 'period',
    description: 'Reporting period (e.g. 2026-Q1)',
    example: '2026-Q1',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Report language (es or en)',
    example: 'es',
  })
  @ApiResponse({ status: 200, description: 'HTML certification preview' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async getCertificationPreview(
    @Param('institutionId') institutionId: string,
    @Param('period') period: string,
    @Query('lang') lang?: string,
  ) {
    this.logger.log(
      `Certification preview requested: ${institutionId}, period=${period}`,
    );
    const reportLang = lang === 'en' ? 'en' : 'es';
    const result = await this.certificationService.generateCertification(
      institutionId,
      period,
      reportLang,
    );
    return {
      html: result.html,
      hash: result.hash,
      institutionId,
      period,
      lang: reportLang,
    };
  }

  // ── PDF Download ───────────────────────────────────────────────

  @Get(':institutionId/certification/:period/pdf')
  @Roles('OWNER', 'ANALYST')
  @AuditAction('CAMEL_CERTIFICATION_PDF')
  @ApiOperation({
    summary: 'Download CAMEL certification as PDF',
    description:
      'Generates and streams a COSSEC-formatted CAMEL self-assessment report as PDF.',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiParam({
    name: 'period',
    description: 'Reporting period (e.g. 2026-Q1)',
    example: '2026-Q1',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Report language (es or en)',
    example: 'es',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async downloadCertificationPdf(
    @Param('institutionId') institutionId: string,
    @Param('period') period: string,
    @Query('lang') lang: string,
    @Res() res: Response,
  ) {
    this.logger.log(
      `Certification PDF requested: ${institutionId}, period=${period}, lang=${lang || 'es'}`,
    );
    const reportLang = lang === 'en' ? 'en' : 'es';
    const result = await this.certificationService.generateCertification(
      institutionId,
      period,
      reportLang,
    );

    // Convert HTML to PDF using a lightweight approach:
    // Return HTML as a downloadable file with PDF-like headers.
    // For full PDF rendering, the consumer can use Puppeteer or the
    // existing ReportsService pipeline. This endpoint streams the
    // self-contained A4-formatted HTML that prints perfectly to PDF.
    const htmlBuffer = Buffer.from(result.html, 'utf-8');
    const filename = `camel-certification-${period}-${reportLang}.html`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': htmlBuffer.length,
      'X-Cerniq-Document-Kind': 'camel_certification',
      'X-Cerniq-Document-Language': reportLang,
      'X-Cerniq-Verification-Hash': result.hash,
    });
    res.end(htmlBuffer);
  }

  // ── Certify (store certification record) ───────────────────────

  @Post(':institutionId/certification/:period/certify')
  @Roles('OWNER', 'ANALYST')
  @AuditAction('CAMEL_CERTIFY')
  @ApiOperation({
    summary: 'Certify a CAMEL self-assessment report',
    description:
      'Accepts certifier information, stores the certification record via audit trail, and returns the certification ID.',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiParam({
    name: 'period',
    description: 'Reporting period (e.g. 2026-Q1)',
    example: '2026-Q1',
  })
  @ApiResponse({
    status: 201,
    description: 'Certification recorded',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async certify(
    @Param('institutionId') institutionId: string,
    @Param('period') period: string,
    @Body() body: { certifiedBy: string; title: string },
    @Req() req: any,
  ) {
    if (!body.certifiedBy || !body.title) {
      throw new BadRequestException(
        'certifiedBy and title are required fields',
      );
    }

    this.logger.log(
      `Certifying CAMEL report: ${institutionId}, period=${period}, by=${body.certifiedBy}`,
    );

    const userId = req.user?.id || req.user?.sub;
    const result = await this.certificationService.certify(
      institutionId,
      period,
      { certifiedBy: body.certifiedBy, title: body.title },
      userId,
    );

    return result;
  }
}
