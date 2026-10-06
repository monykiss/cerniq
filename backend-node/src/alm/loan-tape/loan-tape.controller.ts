import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthTenantGuard } from '../../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { LoanTapeAggregationService } from './loan-tape-aggregation.service';
import { GeographicConcentrationService } from './geographic-concentration.service';
import { FhlbnyCollateralService } from './fhlbny-collateral.service';
import {
  LoanTapeIngestService,
  type LoanTapeIngestResult,
} from './loan-tape-ingest.service';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class LoanTapeUploadBody {
  /** Full CSV text (instrument-level export). */
  csvContent!: string;
  /** Tape as-of date (YYYY-MM-DD). */
  asOfDate!: string;
}

/**
 * Loan-tape HTTP surface (Wave 2, W2.0 Slice 2).
 *
 * Separate controller — zero AlmController constructor slots (EwsController precedent).
 */
@ApiTags('ALM Analysis')
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class LoanTapeController {
  private readonly logger = new Logger(LoanTapeController.name);

  constructor(
    private readonly ingest: LoanTapeIngestService,
    private readonly aggregation: LoanTapeAggregationService,
    private readonly geographic: GeographicConcentrationService,
    private readonly fhlbny: FhlbnyCollateralService,
  ) {}

  @Post(':institutionId/loan-tape')
  @AuditAction('loan_tape_ingest')
  @ApiOperation({
    summary: 'Ingest instrument-level loan tape CSV (all-or-nothing)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async ingestTape(
    @Param('institutionId') institutionId: string,
    @Body() body: LoanTapeUploadBody,
  ): Promise<LoanTapeIngestResult> {
    const csvContent = String(body?.csvContent ?? '');
    const asOfDate = String(body?.asOfDate ?? '').trim();
    this.logger.log({
      event: 'loan_tape_upload',
      institutionId,
      asOfDate,
      bytes: Buffer.byteLength(csvContent, 'utf8'),
    });
    return this.ingest.ingestLoanTape(institutionId, asOfDate, csvContent);
  }

  @Get(':institutionId/loan-tape/rollup')
  @ApiOperation({
    summary: 'Roll up persisted loan tape to segment-shaped view',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async rollup(
    @Param('institutionId') institutionId: string,
    @Query('asOfDate') asOfDateRaw?: string,
  ) {
    const asOfDate = this.requireAsOfDate(asOfDateRaw);
    return this.aggregation.rollUpToSegments(
      institutionId,
      new Date(`${asOfDate}T00:00:00Z`),
    );
  }

  @Get(':institutionId/loan-tape/reconcile')
  @ApiOperation({
    summary:
      'Reconcile loan tape totals vs LoanSegment book (disclosed tolerance)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async reconcile(
    @Param('institutionId') institutionId: string,
    @Query('asOfDate') asOfDateRaw?: string,
  ) {
    const asOfDate = this.requireAsOfDate(asOfDateRaw);
    return this.aggregation.reconcileWithSegments(
      institutionId,
      new Date(`${asOfDate}T00:00:00Z`),
    );
  }

  @Get(':institutionId/loan-tape/geographic-concentration')
  @ApiOperation({
    summary:
      'Municipio HHI + single-borrower concentration from the loan tape (W2.2)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async geographicConcentration(
    @Param('institutionId') institutionId: string,
    @Query('asOfDate') asOfDateRaw?: string,
  ) {
    const asOfDate = this.requireAsOfDate(asOfDateRaw);
    return this.geographic.analyze(
      institutionId,
      new Date(`${asOfDate}T00:00:00Z`),
    );
  }

  @Get(':institutionId/loan-tape/fhlbny-collateral')
  @ApiOperation({
    summary:
      'MODELED FHLBNY collateral eligibility + borrowing-capacity what-ifs (W2.1)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async fhlbnyCollateral(
    @Param('institutionId') institutionId: string,
    @Query('asOfDate') asOfDateRaw?: string,
  ) {
    const asOfDate = this.requireAsOfDate(asOfDateRaw);
    return this.fhlbny.analyze(
      institutionId,
      new Date(`${asOfDate}T00:00:00Z`),
    );
  }

  @Get(':institutionId/loan-tape/fhlbny-collateral/file')
  @ApiOperation({
    summary:
      'Generate the MODELED collateral file (COL-121 stand-in; byte-exact layout pending FHLBNY)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async fhlbnyCollateralFile(
    @Param('institutionId') institutionId: string,
    @Query('asOfDate') asOfDateRaw?: string,
  ) {
    const asOfDate = this.requireAsOfDate(asOfDateRaw);
    return this.fhlbny.generateModeledFile(
      institutionId,
      new Date(`${asOfDate}T00:00:00Z`),
    );
  }

  private requireAsOfDate(raw?: string): string {
    const asOfDate = (raw ?? '').trim();
    if (!ISO_DATE_RE.test(asOfDate)) {
      throw new BadRequestException(
        'asOfDate query param required (YYYY-MM-DD)',
      );
    }
    return asOfDate;
  }
}
