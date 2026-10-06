import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Logger,
  UseGuards,
  UseInterceptors,
  Req,
  Res,
  UploadedFile,
  BadRequestException,
  Optional,
  Inject,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AlmService } from './alm.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { StressTestingService } from './stress-testing/stress-testing.service';
import { ReportsService } from './reports/reports.service';
import { ReportPreflightService } from './reports/report-preflight.service';
import { WorkspaceOnboardingService } from './workspace-onboarding.service';
import { InstitutionSeedService } from './institution-seed.service';
import { listFixtures } from './data/fixtures';
import { CSVIngestionService } from './csv-ingestion.service';
import { AnalysisRunsService } from './analysis-runs.service';
import { IngestionLogsService } from './ingestion-logs.service';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { ScenarioPersistenceService } from './scenarios/scenario-persistence.service';
import { BASEL_SHOCKS, YieldCurveService } from './yield-curve.service';
import { CECLService } from './cecl.service';
import { FTPService } from './ftp.service';
import { DepositBetaService } from './deposit-beta.service';
import { LiquidityAdvancedService } from './liquidity-advanced.service';
import { ConcentrationService } from './concentration.service';
import { NCUADataPullService } from './data-pull/ncua-data-pull.service';
import { SampleReportFactoryService } from './sample-report-factory.service';
import { AlmDocumentExportsService } from './alm-document-exports.service';
import { CossecReportService } from './reports/cossec-report.service';
// Phase IV services
import { LiquidityStressPackService } from './liquidity-stress-pack.service';
import { IRRPolicyService } from './irr-policy.service';
import { DepositBetaLibraryService } from './deposit-beta-library.service';
import { RepricingGapService } from './repricing-gap.service';
import { FTPAttributionService } from './ftp-attribution.service';
import { ForwardSimulationService } from './forward-simulation.service';
import { PeerAnalyticsService } from './peer-analytics.service';
import { CECLVintageService } from './cecl-vintage.service';
import { MonteCarloService } from './monte-carlo.service';
import { OASCalculatorService } from './oas-calculator.service';
import { CreditRiskQuantService } from './credit-risk-quant.service';
import { PortfolioVaRService } from './portfolio-var.service';
import { CapitalOptimizerService } from './capital-optimizer.service';
import { AssetEWSService } from './asset-ews.service';
import { PrepaymentEngineService } from './prepayment-engine.service';
import { SOFRMonitorService } from './sofr-monitor.service';
import { TreasuryRatesService } from './treasury-rates.service';
import { ExamPrepService } from './exam-prep/exam-prep.service';
import { BoardReportService } from './board-report.service';
import { ChatAnalystService } from './chat-analyst.service';
import { NCUA5300Service } from './ncua-5300.service';
import { NetworkIntelligenceService } from './network-intelligence.service';
import { WebhookService } from './webhook.service';
import { UsageMeteringService } from './usage-metering.service';
import { DataPrivacyService } from './data-privacy.service';
import { CsvIngestV2Service } from './csv-ingest-v2.service';
import { NIMOptimizerService } from './nim-optimizer.service';
import { KeyRateDurationService } from './key-rate-duration.service';
import { LiquidityTransferPricingService } from './liquidity-transfer-pricing.service';
import { USVIExpansionService } from './usvi-expansion.service';
import { ResellerService } from './reseller.service';
import { RegulatoryAlertService } from '../ai/regulatory/regulatory-alert.service';
import { AlertDeliveryService } from '../ai/regulatory/alert-delivery.service';
import { CamelForecasterService } from '../ai/camel/camel-forecaster.service';
import { NLIngestService } from '../ai/ingest/nl-ingest.service';
import { PeerSynthesisService } from '../ai/peer/peer-synthesis.service';
import { StressV2Service } from './stress-v2.service';
import { RobustOptimizerService } from './robust-optimizer.service';
import { OptionalitySuiteService } from './optionality-suite.service';
import { CreditConcentrationVaRService } from './credit-conc-var.service';
import { DemoWorkspaceService } from './demo-workspace.service';
import { OnboardingOrchestratorService } from './onboarding-orchestrator.service';
import { ClimateRiskService } from './climate-risk.service';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { NIMAttributionService } from './nim-attribution.service';
import { BehavioralDurationService } from './behavioral-duration.service';
import { HMMRegimeService } from './hmm-regime.service';
import { BlackLittermanService } from './black-litterman.service';
import { CVaROptimizerService } from './cvar-optimizer.service';
import { HRPService } from './hrp.service';
import { CreditMetricsService } from './credit-metrics.service';
import { KMVMertonService } from './kmv-merton.service';
import { PCAYieldCurveService } from './pca-yield-curve.service';
import { FRTBESService } from './frtb-es.service';
import { FedFuturesService } from './fed-futures.service';
import { MacroFactorModelService } from './macro-factor-model.service';
import { CopulaCreditService } from './copula-credit.service';
import { WrongWayRiskService } from './wrong-way-risk.service';
import { IRCapFloorService } from './ir-cap-floor.service';
import { NCUARBC2Service } from './ncua-rbc2.service';
import { TrendAnalysisService } from './trend-analysis.service';
import { DataExportService } from './data-export.service';
import { CustomScenarioService } from './custom-scenario.service';
import { ExcelExportService } from './excel-export.service';
import { buildPdfResponseHeaders } from './document-exports.util';
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
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import {
  ScenarioRequestDto,
  LCRRequestDto,
  FullAnalysisRequestDto,
  BalanceSheetDto,
} from './alm.dto';
import { SaveScenarioDto, CompareScenarioDto } from './dto/save-scenario.dto';
import { YieldCurveShockDto, SaveYieldCurveDto } from './dto/yield-curve.dto';
import { YieldCurveOverrideDto } from './dto/inline-bodies.dto';
import { ImportLoanSegmentsDto, WARMCalculationDto } from './dto/cecl.dto';
import type {
  DurationGapResult,
  NIIResult,
  EVEResult,
  LCRResult,
  BPVResult,
  FullAnalysisResult,
} from './alm.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { BulkBalanceSheetImportDto } from './dto/create-balance-sheet-item.dto';
import { CreateAnalysisRunDto } from './dto/create-analysis-run.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { parseFinancialField } from '../common/utils/financial-field';

@ApiTags('ALM Analysis')
@ApiBearerAuth('BearerAuth')
@Controller('api/alm')
// Class-level cross-tenant + ownership stack. AuthTenantGuard runs first
// (auth → tenant prefix policy → resolves req.tenantId). InstitutionScopeGuard
// then verifies the JWT caller owns the institution named in `:institutionId`
// — when the route has the param. Routes without `:institutionId` (utility
// endpoints like `treasury/rates`, `prepayment/compute`, `demo/build`) pass
// through the institution check; auth + tenant prefix policy still apply.
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class AlmController {
  private readonly logger = new Logger(AlmController.name);

  constructor(
    private readonly almService: AlmService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly cossecReport: CossecReportService,
    private readonly stressTesting: StressTestingService,
    private readonly reportsService: ReportsService,
    private readonly reportPreflight: ReportPreflightService,
    private readonly workspaceOnboarding: WorkspaceOnboardingService,
    private readonly institutionSeed: InstitutionSeedService,
    private readonly csvIngestion: CSVIngestionService,
    private readonly analysisRuns: AnalysisRunsService,
    private readonly ingestionLogs: IngestionLogsService,
    private readonly complianceCalendar: ComplianceCalendarService,
    private readonly scenarioPersistence: ScenarioPersistenceService,
    private readonly yieldCurve: YieldCurveService,
    private readonly cecl: CECLService,
    private readonly ftp: FTPService,
    private readonly depositBeta: DepositBetaService,
    private readonly liquidityAdvanced: LiquidityAdvancedService,
    private readonly concentration: ConcentrationService,
    private readonly ncuaDataPull: NCUADataPullService,
    private readonly sampleReportFactory: SampleReportFactoryService,
    // Phase IV
    private readonly liquidityStressPack: LiquidityStressPackService,
    private readonly irrPolicy: IRRPolicyService,
    private readonly depositBetaLibrary: DepositBetaLibraryService,
    private readonly repricingGap: RepricingGapService,
    private readonly ftpAttribution: FTPAttributionService,
    private readonly forwardSim: ForwardSimulationService,
    private readonly peerAnalytics: PeerAnalyticsService,
    private readonly ceclVintage: CECLVintageService,
    private readonly monteCarlo: MonteCarloService,
    // Phase V
    private readonly oasCalculator: OASCalculatorService,
    private readonly creditRiskQuant: CreditRiskQuantService,
    private readonly portfolioVaR: PortfolioVaRService,
    private readonly capitalOptimizer: CapitalOptimizerService,
    private readonly assetEWS: AssetEWSService,
    private readonly prepaymentEngine: PrepaymentEngineService,
    private readonly sofrMonitor: SOFRMonitorService,
    private readonly treasuryRates: TreasuryRatesService,
    private readonly examPrep: ExamPrepService,
    private readonly boardReport: BoardReportService,
    private readonly chatAnalyst: ChatAnalystService,
    private readonly ncua5300: NCUA5300Service,
    private readonly networkIntel: NetworkIntelligenceService,
    private readonly webhooks: WebhookService,
    private readonly usageMetering: UsageMeteringService,
    private readonly dataPrivacy: DataPrivacyService,
    private readonly csvIngestV2: CsvIngestV2Service,
    private readonly nimOptimizer: NIMOptimizerService,
    private readonly keyRateDuration: KeyRateDurationService,
    private readonly ltp: LiquidityTransferPricingService,
    private readonly usviExpansion: USVIExpansionService,
    private readonly reseller: ResellerService,
    // V6+V7
    private readonly regAlert: RegulatoryAlertService,
    private readonly alertDelivery: AlertDeliveryService,
    private readonly camelForecaster: CamelForecasterService,
    private readonly nlIngest: NLIngestService,
    private readonly peerSynthesis: PeerSynthesisService,
    private readonly stressV2: StressV2Service,
    private readonly robustOptimizer: RobustOptimizerService,
    private readonly optionalitySuite: OptionalitySuiteService,
    private readonly creditConcVaR: CreditConcentrationVaRService,
    private readonly demoWorkspace: DemoWorkspaceService,
    private readonly onboardingOrchestrator: OnboardingOrchestratorService,
    private readonly climateRisk: ClimateRiskService,
    private readonly nimAttribution: NIMAttributionService,
    private readonly behavioralDuration: BehavioralDurationService,
    private readonly hmmRegime: HMMRegimeService,
    private readonly blackLitterman: BlackLittermanService,
    private readonly cvarOptimizer: CVaROptimizerService,
    private readonly hrpService: HRPService,
    private readonly creditMetricsSvc: CreditMetricsService,
    private readonly kmvMerton: KMVMertonService,
    private readonly pcaYieldCurve: PCAYieldCurveService,
    private readonly frtbES: FRTBESService,
    private readonly fedFutures: FedFuturesService,
    private readonly macroFactor: MacroFactorModelService,
    private readonly copulaCredit: CopulaCreditService,
    private readonly wrongWayRisk: WrongWayRiskService,
    private readonly irCapFloor: IRCapFloorService,
    private readonly ncuaRBC2: NCUARBC2Service,
    private readonly trendAnalysis: TrendAnalysisService,
    private readonly dataExport: DataExportService,
    private readonly customScenario: CustomScenarioService,
    private readonly excelExport: ExcelExportService,
    private readonly documentExports: AlmDocumentExportsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  Enterprise Endpoints (DB-backed, auth-protected)
  // ═══════════════════════════════════════════════════════════════

  @Post('institutions')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Create a new financial institution for ALM analysis',
  })
  @ApiResponse({ status: 201, description: 'Institution created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid institution data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createInstitution(@Body() dto: CreateInstitutionDto) {
    this.logger.log(`Creating institution: ${dto.name}`);
    return this.almEnterprise.createInstitution(dto);
  }

  @Get('institutions')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'List institutions for the authenticated user or workspace',
  })
  @ApiQuery({
    name: 'workspaceId',
    required: false,
    description: 'Filter by workspace ID',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of institutions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listInstitutions(
    @Req() req: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    const workspaceId = req.query?.workspaceId;
    if (workspaceId) {
      return this.almEnterprise.getInstitutionsByWorkspace(
        workspaceId,
        pagination,
      );
    }
    // No workspaceId provided — find all institutions for user's workspaces
    return this.almEnterprise.getInstitutionsByUser(
      req.user.userId,
      pagination,
    );
  }

  @Get('institutions/:institutionId')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({ summary: 'Get institution details by ID' })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 200,
    description: 'Institution details with balance sheet summary',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async getInstitution(@Param('institutionId') institutionId: string) {
    return this.almEnterprise.getInstitution(institutionId);
  }

  @Post('institutions/:institutionId/balance-sheet-items')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Import balance sheet line items for an institution',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 201,
    description: 'Balance sheet items imported successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid balance sheet data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async importBalanceSheetItems(
    @Req() req: any,
    @Param('institutionId') institutionId: string,
    @Body() dto: BulkBalanceSheetImportDto,
  ) {
    this.logger.log(
      `Importing ${dto.items.length} balance sheet items for institution ${institutionId}`,
    );
    const result = await this.almEnterprise.importBalanceSheetItems(
      institutionId,
      dto.items,
    );
    this.fireAgentTrigger(
      institutionId,
      `import:${institutionId}:${Date.now()}`,
      req.user?.userId,
    );
    return result;
  }

  @Get('institutions/:institutionId/balance-sheet-items')
  @UseGuards(AuthTenantGuard)
  async listBalanceSheetItems(
    @Param('institutionId') institutionId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.almEnterprise.listBalanceSheetItems(institutionId, pagination);
  }

  @Get(':institutionId/summary')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Get full ALM summary including duration gap, NII, EVE, and LCR',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({ status: 200, description: 'Complete ALM analysis summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async getALMSummary(@Param('institutionId') institutionId: string) {
    this.logger.log(`ALM summary requested for institution ${institutionId}`);
    return this.almEnterprise.getALMSummary(institutionId);
  }

  @Get(':institutionId/cossec-compliance')
  @UseGuards(AuthTenantGuard)
  async getCOSSECCompliance(@Param('institutionId') institutionId: string) {
    this.logger.log(`COSSEC compliance check for institution ${institutionId}`);
    return this.almEnterprise.getCOSSECCompliance(institutionId);
  }

  /**
   * Push-button COSSEC regulatory report (Layer 1, #2 — the demo that
   * closes). One GET → downloadable PDF with the 12-ratio compliance
   * matrix, conclusion-first summary, and traffic-light statuses.
   * Spanish-first: `lang` defaults to `es`; pass `lang=en` for English.
   */
  @Get(':institutionId/cossec-report/pdf')
  @UseGuards(AuthTenantGuard)
  @AuditAction('cossec_report_download')
  @ApiOperation({
    summary: 'Download the COSSEC regulatory compliance report as PDF',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Report language (es default, en secondary)',
    example: 'es',
  })
  @ApiResponse({
    status: 200,
    description: 'COSSEC compliance report PDF binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async downloadCossecReport(
    @Param('institutionId') institutionId: string,
    @Query('lang') lang: string,
    // type-rationale: express @Res() passthrough — raw response for binary PDF streaming, matching the controller's other @Res handlers
    @Res() res: any,
  ) {
    this.logger.log(
      `COSSEC report PDF requested for institution ${institutionId} (lang=${lang || 'es'})`,
    );
    const report = await this.cossecReport.generateCossecReportPdf(
      institutionId,
      lang === 'en' ? 'en' : 'es',
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Content-Length': report.buffer.length,
    });
    res.end(report.buffer);
  }

  @Get(':institutionId/regulatory-compliance')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Check regulatory compliance status (NCUA, COSSEC, Basel III)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 200,
    description: 'Regulatory compliance results with pass/fail indicators',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRegulatoryCompliance(@Param('institutionId') institutionId: string) {
    this.logger.log(
      `Regulatory compliance check for institution ${institutionId}`,
    );
    return this.almEnterprise.getRegulatoryCompliance(institutionId);
  }

  @Get(':institutionId/duration-gap')
  @UseGuards(AuthTenantGuard)
  async getDurationGap(@Param('institutionId') institutionId: string) {
    return this.almEnterprise.calculateDurationGap(institutionId);
  }

  @Get(':institutionId/nii-sensitivity')
  @UseGuards(AuthTenantGuard)
  async getNIISensitivity(@Param('institutionId') institutionId: string) {
    return this.almEnterprise.calculateNIISensitivity(institutionId);
  }

  @Get(':institutionId/liquidity')
  @UseGuards(AuthTenantGuard)
  async getLiquidity(@Param('institutionId') institutionId: string) {
    return this.almEnterprise.calculateLCR(institutionId);
  }

  @Post('analysis/run')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Trigger a full ALM analysis run for an institution',
  })
  @ApiResponse({
    status: 201,
    description: 'Analysis run created and queued for processing',
  })
  @ApiResponse({ status: 400, description: 'Invalid analysis parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createAnalysisRun(@Req() req: any, @Body() dto: CreateAnalysisRunDto) {
    this.logger.log(
      `Analysis run requested for institution ${dto.institutionId}`,
    );
    return this.analysisRuns.createRun(req.user.userId, dto);
  }

  @Get('analysis-runs/:runId')
  @UseGuards(AuthTenantGuard)
  async getAnalysisRun(@Req() req: any, @Param('runId') runId: string) {
    return this.analysisRuns.getRun(req.user.userId, runId);
  }

  @Get('institutions/:institutionId/analysis-runs')
  @UseGuards(AuthTenantGuard)
  async listAnalysisRuns(
    @Req() req: any,
    @Param('institutionId') institutionId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.analysisRuns.listRuns(
      req.user.userId,
      institutionId,
      pagination,
    );
  }

  @Get('institutions/:institutionId/ingestion-logs')
  @UseGuards(AuthTenantGuard)
  async listIngestionLogs(
    @Req() req: any,
    @Param('institutionId') institutionId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.ingestionLogs.listInstitutionLogs(
      req.user.userId,
      institutionId,
      pagination,
    );
  }

  @Get(':institutionId/calendar')
  @UseGuards(AuthTenantGuard)
  async getComplianceCalendar(@Param('institutionId') institutionId: string) {
    this.logger.log(
      `Compliance calendar requested for institution ${institutionId}`,
    );
    return this.complianceCalendar.getUpcomingDeadlines(institutionId);
  }

  @Post('institutions/:institutionId/upload-csv')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({ summary: 'Upload a CSV file to import balance sheet data' })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    description: 'Set to "true" to validate without importing',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV file containing balance sheet line items',
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'CSV parsed and balance sheet items imported',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid CSV format or validation errors',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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
  async uploadCSV(
    @Req() req: any,
    @Param('institutionId') institutionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No CSV file provided');
    }

    this.logger.log(
      `CSV upload for institution ${institutionId} (${file.size} bytes, dryRun=${dryRun})`,
    );

    const csvContent = file.buffer.toString('utf-8');
    const result = this.csvIngestion.parseCSV(csvContent);
    const isDryRun = dryRun === 'true';

    if (!result.valid) {
      const log = await this.ingestionLogs.recordLog({
        userId: req.user.userId,
        institutionId,
        source: 'manual_upload',
        sourceFilename: file.originalname,
        dryRun: isDryRun,
        status: 'FAILED',
        parseResult: result,
      });
      return { ...result, imported: false, ingestionLogId: log.id };
    }

    // Dry run: validate only, don't import
    if (isDryRun) {
      const log = await this.ingestionLogs.recordLog({
        userId: req.user.userId,
        institutionId,
        source: 'manual_upload',
        sourceFilename: file.originalname,
        dryRun: true,
        status: 'DRY_RUN',
        parseResult: result,
      });
      return { ...result, imported: false, ingestionLogId: log.id };
    }

    // Import validated items
    const importResult = await this.almEnterprise.importBalanceSheetItems(
      institutionId,
      result.items,
    );
    const log = await this.ingestionLogs.recordLog({
      userId: req.user.userId,
      institutionId,
      source: 'manual_upload',
      sourceFilename: file.originalname,
      status: 'IMPORTED',
      parseResult: result,
      importedCount: importResult.count,
    });

    this.fireAgentTrigger(institutionId, log.id, req.user?.userId);

    return {
      ...result,
      imported: true,
      importedCount: importResult.count,
      ingestionLogId: log.id,
    };
  }

  private fireAgentTrigger(
    institutionId: string,
    balanceSheetId: string,
    triggeredByUserId?: string,
  ): void {
    try {
      const {
        AgentTriggerService,
      } = require('../agents/trigger/agent-trigger.service');
      const trigger = this.moduleRef.get(AgentTriggerService, {
        strict: false,
      });
      trigger.onBalanceSheetUploaded({
        balanceSheetId,
        institutionId,
        triggeredByUserId: triggeredByUserId ?? null,
      });
    } catch {
      this.logger.debug(
        'AgentTriggerService not available — agent trigger skipped',
      );
    }
  }

  @Get('templates/:type')
  getCSVTemplate(
    @Param('type') type: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv =
      type === 'cooperativa'
        ? this.csvIngestion.getCooperativaTemplate()
        : this.csvIngestion.getGenericTemplate();

    const filename = `balance_sheet_template_${type}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return '\uFEFF' + csv;
  }

  /**
   * @deprecated Use `POST /api/alm/institutions/seed` with a fixture key instead.
   *
   * This legacy endpoint creates a fresh (non-idempotent) institution each call.
   * Re-invocation produces duplicates. As of 2026-04-14 the frontend migrated
   * all four institution types to the idempotent fixture path (Phase 1
   * complete); this endpoint is retained only for out-of-tree callers (CLI
   * tests, ad-hoc scripts) and will be removed once those callers migrate.
   *
   * Fixture mapping:
   *   bank          -> pr-bank-demo
   *   credit_union  -> pr-credit-union-demo
   *   family_office -> pr-family-office-demo
   *   cooperativa   -> pr-cooperativa-demo
   */
  @Post('seed-demo')
  @UseGuards(AuthTenantGuard)
  async seedDemoData(
    @Body()
    body: {
      workspaceId: string;
      type: 'bank' | 'credit_union' | 'family_office' | 'cooperativa';
    },
  ) {
    this.logger.warn(
      `[DEPRECATED] POST /api/alm/seed-demo (type=${body.type}, workspace=${body.workspaceId}) — migrate caller to POST /api/alm/institutions/seed with a fixture key`,
    );
    return this.workspaceOnboarding.seedDemoData(body.workspaceId, body.type);
  }

  // ─── Institution fixture seeding (idempotent, transactional) ──────────
  // The new pickup-friendly path. Re-running this endpoint with the same
  // (workspaceId, fixtureKey) is a supported no-op — see SESSION_HANDOFF.md.

  @Get('fixtures')
  @UseGuards(AuthTenantGuard)
  async listInstitutionFixtures() {
    return {
      fixtures: listFixtures().map((f) => ({
        seedKey: f.seedKey,
        name: f.name,
        type: f.type,
        totalAssets: f.totalAssets,
        currency: f.currency,
        reportingDate: f.reportingDate,
        itemCount: f.items.length,
      })),
    };
  }

  @Post('institutions/seed')
  @UseGuards(AuthTenantGuard)
  async seedInstitutionFromFixture(
    @Body()
    body: {
      workspaceId: string;
      fixture: string;
    },
  ) {
    if (!body?.workspaceId || !body?.fixture) {
      throw new BadRequestException('workspaceId and fixture are required');
    }
    this.logger.log(
      `seedInstitutionFromFixture: workspace=${body.workspaceId}, fixture=${body.fixture}`,
    );
    return this.institutionSeed.seedFromFixture(body.workspaceId, body.fixture);
  }

  // ─── Report preflight (D1, 2026-04-07) ────────────────────────
  // The "is this report safe to ship?" API. Returns the unified gap manifest
  // from every ALM sub-call (LCR, COSSEC, regulatory stress) plus a
  // `ready: boolean`. Frontend gates download buttons on `ready === true`,
  // the action registry uses it as a precheck before dispatching report
  // generation, and the audit pipeline logs it for compliance review.

  @Get(':institutionId/preflight')
  @UseGuards(AuthTenantGuard)
  async preflightReport(@Param('institutionId') institutionId: string) {
    this.logger.log(`Report preflight for institution ${institutionId}`);
    return this.reportPreflight.check(institutionId);
  }

  // ─── FTP (Funds Transfer Pricing) ────────────────────────────────

  @Get(':institutionId/ftp')
  @UseGuards(AuthTenantGuard)
  async getFTPAnalysis(@Param('institutionId') institutionId: string) {
    this.logger.log(`FTP analysis for institution ${institutionId}`);
    return this.ftp.getFTPAnalysis(institutionId);
  }

  @Post(':institutionId/ftp/custom')
  @UseGuards(AuthTenantGuard)
  async runCustomFTP(
    @Param('institutionId') institutionId: string,
    @Body() body: YieldCurveOverrideDto,
  ) {
    return this.ftp.getFTPAnalysis(institutionId, body.spreadAdjBps);
  }

  @Get(':institutionId/ftp/segments')
  @UseGuards(AuthTenantGuard)
  async getFTPSegments(@Param('institutionId') institutionId: string) {
    return this.ftp.getFTPSegments(institutionId);
  }

  // ─── CECL Credit Loss ────────────────────────────────────────────

  @Get(':institutionId/cecl')
  @UseGuards(AuthTenantGuard)
  async getCECLAnalysis(
    @Param('institutionId') institutionId: string,
    @Query('methodology') methodology?: string,
  ) {
    this.logger.log(
      `CECL analysis for institution ${institutionId} (method=${methodology || 'warm'})`,
    );
    return this.cecl.getCECLAnalysis(institutionId, methodology);
  }

  @Post(':institutionId/cecl/segments')
  @UseGuards(AuthTenantGuard)
  async importLoanSegments(
    @Param('institutionId') institutionId: string,
    @Body() dto: ImportLoanSegmentsDto,
  ) {
    this.logger.log(
      `Importing ${dto.segments.length} loan segments for institution ${institutionId}`,
    );
    return this.cecl.importLoanSegments(institutionId, dto.segments);
  }

  @Get(':institutionId/cecl/forecast')
  @UseGuards(AuthTenantGuard)
  async getCECLForecast(@Param('institutionId') institutionId: string) {
    return this.cecl.getCECLForecast(institutionId);
  }

  /**
   * Cooperativa-native CECL (Layer 1): segments auto-classified against
   * the PR product registry (préstamos personales, auto, hipotecas, MBL,
   * garantía de acciones), cold-start PD/LGD from documented PR defaults,
   * PD×LGD under the PR macro overlay. Spanish-first gap messages.
   */
  @Get(':institutionId/cecl/cooperativa')
  @UseGuards(AuthTenantGuard)
  async getCooperativaCECL(@Param('institutionId') institutionId: string) {
    this.logger.log(
      `Cooperativa CECL (PR overlay) for institution ${institutionId}`,
    );
    return this.cecl.getCooperativaCECLAnalysis(institutionId);
  }

  @Post('cecl/warm')
  @UseGuards(AuthTenantGuard)
  async runWARMCalculation(@Body() dto: WARMCalculationDto) {
    return this.cecl.calculateWARM(dto.segments);
  }

  // ─── Yield Curve ─────────────────────────────────────────────────

  @Get(':institutionId/yield-curve-analysis')
  @UseGuards(AuthTenantGuard)
  async getYieldCurveAnalysis(@Param('institutionId') institutionId: string) {
    this.logger.log(`Yield curve analysis for institution ${institutionId}`);
    return this.yieldCurve.getYieldCurveAnalysis(institutionId);
  }

  // GET alias for the Rate Shock v2 panel.
  //
  // Unlike the other compute aliases, this endpoint's `shockBpsPerTenor` is
  // REQUIRED — there is no "run with defaults" already defined by the service.
  // Rather than invent a shock table, the alias reuses BASEL_SHOCKS.steepener,
  // the same canonical Basel IRRBB definition the yield-curve service applies
  // for its own shock modelling, and the panel's own headline scenario
  // ("Non-parallel shocks: steepener, flattener, twist"). The POST remains the
  // way to run any other tenor vector.
  @Get(':institutionId/yield-curve/forward-nii')
  @UseGuards(AuthTenantGuard)
  async getForwardNII(@Param('institutionId') institutionId: string) {
    return this.yieldCurve.computeForwardNIISchedule(
      institutionId,
      BASEL_SHOCKS.steepener,
    );
  }

  @Post(':institutionId/yield-curve/forward-nii')
  @UseGuards(AuthTenantGuard)
  async computeForwardNII(
    @Param('institutionId') institutionId: string,
    @Body()
    body: { shockBpsPerTenor: Record<string, number>; quarters?: number },
  ) {
    return this.yieldCurve.computeForwardNIISchedule(
      institutionId,
      body.shockBpsPerTenor,
      body.quarters,
    );
  }

  @Post('yield-curve/shocks')
  @UseGuards(AuthTenantGuard)
  async applyYieldCurveShocks(@Body() dto: YieldCurveShockDto) {
    // If curveId provided, load that curve; otherwise use default
    const baseCurve = undefined;
    return this.yieldCurve.applyShock(
      baseCurve ?? [
        { tenor: 0.25, rate: 0.048 },
        { tenor: 0.5, rate: 0.0465 },
        { tenor: 1, rate: 0.044 },
        { tenor: 2, rate: 0.042 },
        { tenor: 3, rate: 0.041 },
        { tenor: 5, rate: 0.0405 },
        { tenor: 7, rate: 0.041 },
        { tenor: 10, rate: 0.042 },
        { tenor: 20, rate: 0.0455 },
        { tenor: 30, rate: 0.0465 },
      ],
      dto.shockType,
      dto.customShocks,
    );
  }

  @Post('yield-curve/custom')
  @UseGuards(AuthTenantGuard)
  async saveCustomYieldCurve(@Body() dto: SaveYieldCurveDto) {
    this.logger.log(
      `Saving custom yield curve "${dto.name}" for institution ${dto.institutionId}`,
    );
    return this.yieldCurve.saveCustomCurve(dto);
  }

  // ─── Scenario Persistence ────────────────────────────────────────

  @Post('scenarios/save')
  @UseGuards(AuthTenantGuard)
  async saveScenario(@Req() req: any, @Body() dto: SaveScenarioDto) {
    this.logger.log(
      `Saving scenario "${dto.name}" for institution ${dto.institutionId}`,
    );
    return this.scenarioPersistence.saveScenario(req.user.userId, dto);
  }

  @Get(':institutionId/scenarios')
  @UseGuards(AuthTenantGuard)
  async listScenarios(
    @Param('institutionId') institutionId: string,
    @Query() query: PaginationQueryDto & { tag?: string },
  ) {
    return this.scenarioPersistence.listScenarios(institutionId, query);
  }

  @Get('scenarios/:scenarioId')
  @UseGuards(AuthTenantGuard)
  async getScenario(@Param('scenarioId') scenarioId: string) {
    return this.scenarioPersistence.getScenario(scenarioId);
  }

  @Post('scenarios/compare')
  @UseGuards(AuthTenantGuard)
  async compareScenarios(@Body() dto: CompareScenarioDto) {
    return this.scenarioPersistence.compareScenarios(dto.scenarioIds);
  }

  @Post('scenarios/:scenarioId/duplicate')
  @UseGuards(AuthTenantGuard)
  async duplicateScenario(
    @Req() req: any,
    @Param('scenarioId') scenarioId: string,
    @Body() body: { name?: string },
  ) {
    return this.scenarioPersistence.duplicateScenario(
      scenarioId,
      req.user.userId,
      body.name,
    );
  }

  @Post('scenarios/:scenarioId/delete')
  @UseGuards(AuthTenantGuard)
  async deleteScenario(@Param('scenarioId') scenarioId: string) {
    return this.scenarioPersistence.deleteScenario(scenarioId);
  }

  // ─── Deposit Beta ───────────────────────────────────────────────

  @Get(':institutionId/deposit-betas')
  @UseGuards(AuthTenantGuard)
  async getDepositBetas(@Param('institutionId') institutionId: string) {
    return this.depositBeta.getDepositBetas(institutionId);
  }

  @Post(':institutionId/deposit-betas')
  @UseGuards(AuthTenantGuard)
  async updateDepositBetas(
    @Param('institutionId') institutionId: string,
    @Body() body: { betas: Array<{ subcategory: string; beta: number }> },
  ) {
    return this.depositBeta.updateDepositBetas(institutionId, body.betas);
  }

  @Get(':institutionId/deposit-beta-impact')
  @UseGuards(AuthTenantGuard)
  async getDepositBetaImpact(
    @Param('institutionId') institutionId: string,
    @Query('shockBps') shockBps?: string,
  ) {
    return this.depositBeta.calculateBetaImpact(
      institutionId,
      shockBps ? parseInt(shockBps) : 100,
    );
  }

  // ─── Advanced Liquidity ────────────────────────────────────────

  @Get(':institutionId/liquidity-advanced')
  @UseGuards(AuthTenantGuard)
  async getAdvancedLiquidity(@Param('institutionId') institutionId: string) {
    this.logger.log(
      `Advanced liquidity analysis for institution ${institutionId}`,
    );
    return this.liquidityAdvanced.getAdvancedLiquidity(institutionId);
  }

  // ─── Concentration ─────────────────────────────────────────────

  @Get(':institutionId/concentration')
  @UseGuards(AuthTenantGuard)
  async getConcentrationAnalysis(
    @Param('institutionId') institutionId: string,
  ) {
    this.logger.log(`Concentration analysis for institution ${institutionId}`);
    return this.concentration.getConcentrationAnalysis(institutionId);
  }

  @Post(':institutionId/concentration/limits')
  @UseGuards(AuthTenantGuard)
  async saveConcentrationLimits(
    @Param('institutionId') institutionId: string,
    @Body()
    body: {
      limits: Array<{ limitType: string; limitName: string; maxPct: number }>;
    },
  ) {
    return this.concentration.saveConcentrationLimits(
      institutionId,
      body.limits,
    );
  }

  // ─── NCUA Auto-Pull ────────────────────────────────────────────

  @Post('ncua/pull')
  @UseGuards(AuthTenantGuard)
  async pullNCUAData(@Body() body: { charterNumber: string }) {
    this.logger.log(`NCUA data pull for charter ${body.charterNumber}`);
    return this.ncuaDataPull.pullByCharterNumber(body.charterNumber);
  }

  // ─── Stress Testing ────────────────────────────────────────────

  @Post(':institutionId/stress-test')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 runs per minute — heavy compute
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Run Monte Carlo interest rate stress test on an institution',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 201,
    description: 'Stress test results with scenario outcomes',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (max 5/min)' })
  async runStressTest(
    @Param('institutionId') institutionId: string,
    @Body()
    params: {
      paths?: number;
      horizon?: number;
      volatility?: number;
      meanReversion?: number;
    },
  ) {
    this.logger.log(`Stress test requested for institution ${institutionId}`);
    return this.stressTesting.runFullStressTest(institutionId, params);
  }

  /**
   * Formal NEV (Net Economic Value / Valor Económico Neto) supervisory
   * analysis: ±100/200/300bps parallel shocks, duration+convexity
   * revaluation, classified per the COSSEC CC-2025-01 / CAMEL-S two-
   * dimensional bands (NEV ratio + sensitivity) on the +300bps point.
   */
  @Get(':institutionId/stress-test/nev')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary:
      'NEV supervisory analysis (±100/200/300bps), COSSEC CC-2025-01 / CAMEL-S risk bands',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({ status: 200, description: 'NEV shock table + risk rating' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNEVAnalysis(@Param('institutionId') institutionId: string) {
    this.logger.log(`NEV analysis requested for institution ${institutionId}`);
    return this.stressTesting.getNEVAnalysis(institutionId);
  }

  @Post(':institutionId/stress/custom')
  @UseGuards(AuthTenantGuard)
  async runCustomStressScenario(
    @Param('institutionId') institutionId: string,
    @Body()
    params: {
      rateShockBps: number;
      depositRunoffPct: number;
      defaultRateIncreasePct: number;
      energyCostShockPct: number;
    },
  ) {
    this.logger.log(
      `Custom stress scenario for institution ${institutionId}: rate=${params.rateShockBps}bps`,
    );
    return this.stressTesting.runCustomScenario(institutionId, params);
  }

  // ─── Custom Rate Shock Scenario Builder ─────────────────────────

  @Post(':institutionId/scenario/custom')
  @UseGuards(AuthTenantGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Run a custom rate-shock scenario with yield curve twist, deposit runoff, defaults, and prepayment multiplier',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 201,
    description:
      'Custom scenario results including NII impact, EVE change, LCR impact, capital impact, and narrative',
  })
  @ApiResponse({ status: 400, description: 'Invalid scenario parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (max 10/min)',
  })
  async runCustomScenario(
    @Param('institutionId') institutionId: string,
    @Body()
    params: {
      name: string;
      rateShiftBps: number;
      yieldCurveTwist?: number;
      depositRunoff?: number;
      loanDefaultIncrease?: number;
      prepaymentMultiplier?: number;
    },
  ) {
    this.logger.log(
      `Custom scenario "${params.name}" for institution ${institutionId}`,
    );
    return this.customScenario.runCustomScenario(institutionId, params);
  }

  // ─── Excel Export ───────────────────────────────────────────────

  @Get(':institutionId/export/excel')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Export ALM report as Excel workbook (XML SpreadsheetML format)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 200,
    description: 'Excel workbook binary stream',
    content: { 'application/vnd.ms-excel': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async exportExcel(@Param('institutionId') id: string, @Res() res: any) {
    this.logger.log(`Excel export requested for institution ${id}`);
    const buffer = await this.excelExport.exportToExcel(id);
    res.set({
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="cerniq-alm-report-${id.slice(0, 8)}.xls"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get(':institutionId/report')
  @UseGuards(AuthTenantGuard)
  @AuditAction('report_download')
  @ApiOperation({ summary: 'Download a full ALM analysis report as PDF' })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Report language (en or es)',
    example: 'en',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF report binary stream',
    content: { 'application/pdf': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Institution not found' })
  async downloadReport(
    @Param('institutionId') institutionId: string,
    @Query('lang') lang: string,
    @Res() res: any,
  ) {
    this.logger.log(
      `PDF report requested for institution ${institutionId} (lang=${lang || 'en'})`,
    );
    const document = await this.documentExports.generateInstitutionExport(
      institutionId,
      lang === 'es' ? 'es' : 'en',
    );
    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  @Get(':institutionId/exports')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'List team-ready export manifests for an institution',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiResponse({
    status: 200,
    description: 'Export manifests for institutional documents',
  })
  async listInstitutionExports(@Param('institutionId') institutionId: string) {
    return this.documentExports.listInstitutionExports(institutionId);
  }

  @Get('previews/:slug/exports')
  @ApiOperation({
    summary: 'List export manifests for a public preview document',
  })
  async listPreviewExports(@Param('slug') slug: string) {
    return this.documentExports.listPreviewExports(slug);
  }

  @Get('previews/:slug/report')
  @ApiOperation({
    summary: 'Download a public preview document as PDF',
  })
  async downloadPreviewReport(
    @Param('slug') slug: string,
    @Query('lang') lang: string,
    @Res() res: any,
  ) {
    const document = await this.documentExports.generatePreviewExport(
      slug,
      lang === 'en' ? 'en' : 'es',
    );
    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  // ─── MP-003: CECL Vintage Analyzer ──────────────────────────────

  @Get(':institutionId/cecl/vintage')
  @UseGuards(AuthTenantGuard)
  async getCECLVintage(
    @Param('institutionId') institutionId: string,
    @Query('scenario') scenario?: string,
  ) {
    return this.ceclVintage.runVintageAnalysis(
      institutionId,
      (scenario as 'base' | 'adverse' | 'severe') ?? 'base',
    );
  }

  @Get(':institutionId/cecl/cohorts')
  @UseGuards(AuthTenantGuard)
  async getCECLCohorts(@Param('institutionId') institutionId: string) {
    return this.ceclVintage.getCohortMatrix(institutionId);
  }

  @Post(':institutionId/cecl/cohorts/upload')
  @UseGuards(AuthTenantGuard)
  async uploadCohorts(
    @Param('institutionId') institutionId: string,
    @Body() body: { cohorts: any[] },
  ) {
    return this.ceclVintage.importCohorts(institutionId, body.cohorts);
  }

  // ─── MP-013: Monte Carlo Simulation ───────────────────────────

  // GET alias for the panel. NOTE the path differs from the POST: the
  // registry (and therefore the panel) asks for `/monte-carlo`, while the
  // POST lives at `/monte-carlo/run`. Aliasing at the path the panel
  // actually requests is what makes it live. Same throttle — identical
  // 10k-path compute.
  @Get(':institutionId/monte-carlo')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @UseGuards(AuthTenantGuard)
  async getMonteCarlo(@Param('institutionId') institutionId: string) {
    return this.monteCarlo.runSimulation(institutionId, {});
  }

  @Post(':institutionId/monte-carlo/run')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 runs per minute — heavy compute
  @UseGuards(AuthTenantGuard)
  async runMonteCarlo(
    @Param('institutionId') institutionId: string,
    @Body()
    body: {
      paths?: number;
      quarters?: number;
      kappa?: number;
      theta?: number;
      sigma?: number;
    },
  ) {
    this.logger.log(
      `Monte Carlo ${body.paths ?? 10000} paths for ${institutionId}`,
    );
    return this.monteCarlo.runSimulation(institutionId, body);
  }

  // ─── Phase IV: COSSEC Stress Pack (MP-004) ──────────────────────

  @Get(':institutionId/stress-pack')
  @UseGuards(AuthTenantGuard)
  async runStressPack(@Param('institutionId') institutionId: string) {
    this.logger.log(`COSSEC 5-scenario stress pack for ${institutionId}`);
    return this.liquidityStressPack.runAllScenarios(institutionId);
  }

  @Get(':institutionId/stress-pack/:scenarioId')
  @UseGuards(AuthTenantGuard)
  async runStressPackScenario(
    @Param('institutionId') institutionId: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.liquidityStressPack.runScenario(institutionId, scenarioId);
  }

  // ─── Phase IV: IRR Policy Engine (MP-005) ──────────────────────

  @Get(':institutionId/irr-policy')
  @UseGuards(AuthTenantGuard)
  async getIRRPolicyDashboard(@Param('institutionId') institutionId: string) {
    return this.irrPolicy.checkAll(institutionId);
  }

  @Get(':institutionId/irr-policy/limits')
  @UseGuards(AuthTenantGuard)
  async getIRRPolicyLimits(@Param('institutionId') institutionId: string) {
    return this.irrPolicy.getLimits(institutionId);
  }

  @Post(':institutionId/irr-policy/limits')
  @UseGuards(AuthTenantGuard)
  async saveIRRPolicyLimits(
    @Param('institutionId') institutionId: string,
    @Body() body: { limits: any[] },
  ) {
    return this.irrPolicy.saveLimits(institutionId, body.limits);
  }

  @Get(':institutionId/irr-policy/breaches')
  @UseGuards(AuthTenantGuard)
  async getBreachHistory(@Param('institutionId') institutionId: string) {
    return this.irrPolicy.getBreachHistory(institutionId);
  }

  // ─── Phase IV: Deposit Beta Library (MP-007) ───────────────────

  @Get(':institutionId/deposit-beta/benchmark')
  @UseGuards(AuthTenantGuard)
  async getDepositBetaBenchmark(@Param('institutionId') institutionId: string) {
    return this.depositBetaLibrary.getBenchmark(institutionId);
  }

  @Get('deposit-beta/library')
  @UseGuards(AuthTenantGuard)
  async getDepositBetaLibrary() {
    return this.depositBetaLibrary.getRawLibrary();
  }

  // ─── Phase IV: Repricing Gap (MP-008) ──────────────────────────

  @Get(':institutionId/repricing-gap')
  @UseGuards(AuthTenantGuard)
  async getRepricingGap(
    @Param('institutionId') institutionId: string,
    @Query('policyLimitPct') policyLimitPct?: string,
  ) {
    this.logger.log(`Repricing gap for ${institutionId}`);
    // D23: Validate the user-supplied policy-limit % query param.
    // Previously `parseFloat("15abc")` silently became 15 and
    // `parseFloat("1e400")` became Infinity. Reasonable policy
    // limits sit in [0, 100] %; fall back to 15 on any invalid input.
    const validatedLimit = policyLimitPct
      ? (parseFinancialField(policyLimitPct, { min: 0, max: 100 }) ?? 15)
      : 15;
    return this.repricingGap.getRepricingGap(institutionId, validatedLimit);
  }

  // ─── Phase IV: FTP v2 Attribution (MP-009) ─────────────────────

  @Get(':institutionId/ftp/attribution')
  @UseGuards(AuthTenantGuard)
  async getFTPAttribution(@Param('institutionId') institutionId: string) {
    this.logger.log(`FTP attribution for ${institutionId}`);
    return this.ftpAttribution.getFullAttribution(institutionId);
  }

  // ─── Phase IV: Forward Simulation (MP-010) ─────────────────────

  // GET alias for the panel — see the black-litterman alias.
  @Get(':institutionId/forward-simulation')
  @UseGuards(AuthTenantGuard)
  async getForwardSimulation(@Param('institutionId') institutionId: string) {
    return this.forwardSim.runForwardSimulation({ institutionId });
  }

  @Post(':institutionId/forward-simulation')
  @UseGuards(AuthTenantGuard)
  async runForwardSimulation(
    @Param('institutionId') institutionId: string,
    @Body()
    body: {
      horizon?: number;
      growthAssumptions?: Record<string, number>;
      prepaymentAssumptions?: Record<string, number>;
      ratePaths?: string[];
    },
  ) {
    this.logger.log(`Forward simulation for ${institutionId}`);
    return this.forwardSim.runForwardSimulation({ institutionId, ...body });
  }

  // ─── Phase IV: Peer Analytics (MP-011) ─────────────────────────

  @Get(':institutionId/peer-analytics')
  @UseGuards(AuthTenantGuard)
  async getPeerAnalytics(@Param('institutionId') institutionId: string) {
    this.logger.log(`Peer analytics for ${institutionId}`);
    return this.peerAnalytics.getPeerAnalytics(institutionId);
  }

  // ─── Phase V: OAS Calculator (MP-014) ──────────────────────────

  @Get(':institutionId/oas')
  @UseGuards(AuthTenantGuard)
  async getOASPortfolio(@Param('institutionId') institutionId: string) {
    this.logger.log(`OAS portfolio analysis for ${institutionId}`);
    return this.oasCalculator.analyzePortfolio(institutionId);
  }

  // ─── Phase V: Credit Risk Quant (MP-015) ──────────────────────

  @Get(':institutionId/credit-risk')
  @UseGuards(AuthTenantGuard)
  async getCreditRisk(@Param('institutionId') institutionId: string) {
    this.logger.log(`Credit risk quant for ${institutionId}`);
    return this.creditRiskQuant.analyzePortfolio(institutionId);
  }

  // ─── Phase V: Portfolio VaR (MP-017) ──────────────────────────

  @Get(':institutionId/var')
  @UseGuards(AuthTenantGuard)
  async getVaRSuite(
    @Param('institutionId') institutionId: string,
    @Query('confidence') confidence?: string,
    @Query('horizon') horizon?: string,
  ) {
    this.logger.log(`VaR suite for ${institutionId}`);
    return this.portfolioVaR.computeVaRSuite(
      institutionId,
      confidence === '99' ? 0.99 : 0.95,
      horizon === '10' ? 10 : 1,
    );
  }

  // ─── Phase V: Capital Optimizer (MP-019) ──────────────────────

  // GET alias for the panel — see the black-litterman alias.
  @Get(':institutionId/optimize')
  @UseGuards(AuthTenantGuard)
  async getCapitalOptimization(@Param('institutionId') institutionId: string) {
    return this.capitalOptimizer.optimize(institutionId);
  }

  @Post(':institutionId/optimize')
  @UseGuards(AuthTenantGuard)
  async optimizeCapital(
    @Param('institutionId') institutionId: string,
    @Body()
    body: { aggressiveness?: 'conservative' | 'moderate' | 'aggressive' },
  ) {
    this.logger.log(
      `Capital optimization for ${institutionId} (${body.aggressiveness ?? 'moderate'})`,
    );
    return this.capitalOptimizer.optimize(institutionId, body.aggressiveness);
  }

  // ─── Phase V: Asset Quality EWS (MP-018) ──────────────────────

  @Get(':institutionId/ews')
  @UseGuards(AuthTenantGuard)
  async getAssetEWS(@Param('institutionId') institutionId: string) {
    this.logger.log(`Asset EWS for ${institutionId}`);
    return this.assetEWS.computeEWS(institutionId);
  }

  // ─── Phase V: Prepayment Engine (MP-016) ──────────────────────

  @Post('prepayment/compute')
  @UseGuards(AuthTenantGuard)
  async computePrepayment(
    @Body()
    body: {
      mortgageRate: number;
      currentMarketRate: number;
      ageMonths: number;
      month?: number;
      burnoutFactor?: number;
      disasterOverride?: number;
    },
  ) {
    return this.prepaymentEngine.computePRCPR(body);
  }

  @Post('prepayment/sensitivity')
  @UseGuards(AuthTenantGuard)
  async prepaymentSensitivity(
    @Body()
    body: {
      mortgageRate: number;
      currentMarketRate: number;
      ageMonths?: number;
    },
  ) {
    return this.prepaymentEngine.computeSensitivity(
      body.mortgageRate,
      body.currentMarketRate,
      body.ageMonths,
    );
  }

  // ─── Phase V: SOFR Monitor (MP-022) ──────────────────────────

  @Get(':institutionId/sofr-exposure')
  @UseGuards(AuthTenantGuard)
  async getSOFRExposure(@Param('institutionId') institutionId: string) {
    return this.sofrMonitor.getExposureReport(institutionId);
  }

  // ─── Phase V: Treasury Rates (MP-025) ─────────────────────────

  @Get('treasury/rates')
  @UseGuards(AuthTenantGuard)
  async getTreasuryRates() {
    return this.treasuryRates.getLatestSnapshot();
  }

  @Get('treasury/curve')
  @UseGuards(AuthTenantGuard)
  async getTreasuryCurve() {
    return this.treasuryRates.getYieldCurvePoints();
  }

  // ─── Phase VI: COSSEC Exam Prep (MP-027) ───────────────────────

  @Get(':institutionId/exam-prep')
  @UseGuards(AuthTenantGuard)
  async getExamPrep(@Param('institutionId') institutionId: string) {
    this.logger.log(`COSSEC exam prep for ${institutionId}`);
    return this.examPrep.getExamPrep(institutionId);
  }

  // ─── Phase VI: Board Report (MP-030) ────────────────────────────

  @Get(':institutionId/board-report')
  @UseGuards(AuthTenantGuard)
  async getBoardReport(@Param('institutionId') institutionId: string) {
    this.logger.log(`Board report for ${institutionId}`);
    return this.boardReport.generateBoardReportData(institutionId);
  }

  // ─── Phase VI: Chat Analyst (MP-031) ──────────────────────────

  @Post(':institutionId/analyst/chat')
  @UseGuards(AuthTenantGuard)
  async chatWithAnalyst(
    @Param('institutionId') institutionId: string,
    @Body() body: { message: string; sessionId: string; lang?: string },
  ) {
    return this.chatAnalyst.processMessage(
      institutionId,
      body.sessionId,
      body.message,
      body.lang,
    );
  }

  @Get('analyst/tools')
  @UseGuards(AuthTenantGuard)
  async getAnalystTools() {
    return this.chatAnalyst.getAvailableTools();
  }

  // ─── Phase VI: NCUA 5300 (MP-029) ─────────────────────────────

  @Get(':institutionId/form-5300')
  @UseGuards(AuthTenantGuard)
  async getForm5300(
    @Param('institutionId') institutionId: string,
    @Query('quarter') quarter?: string,
  ) {
    this.logger.log(`NCUA 5300 for ${institutionId} (${quarter ?? 'current'})`);
    return this.ncua5300.generateForm5300(institutionId, quarter);
  }

  // ─── Phase VI: Network Intelligence (MP-026) ───────────────────

  @Get('network/overview')
  @UseGuards(AuthTenantGuard)
  async getNetworkOverview() {
    this.logger.log('Network intelligence overview');
    return this.networkIntel.getNetworkOverview();
  }

  // ─── Phase VI: Webhooks (MP-032) ──────────────────────────────

  @Post(':institutionId/webhooks')
  @UseGuards(AuthTenantGuard)
  async createWebhook(
    @Param('institutionId') institutionId: string,
    @Body() body: { url: string; events: string[] },
  ) {
    return this.webhooks.createSubscription(institutionId, body as any);
  }

  @Get(':institutionId/webhooks')
  @UseGuards(AuthTenantGuard)
  async listWebhooks(@Param('institutionId') institutionId: string) {
    return this.webhooks.listSubscriptions(institutionId);
  }

  @Post('webhooks/:webhookId/delete')
  @UseGuards(AuthTenantGuard)
  async deleteWebhook(@Param('webhookId') webhookId: string) {
    return this.webhooks.deleteSubscription(webhookId);
  }

  // ─── Phase VII: Usage Metering (MP-044) ───────────────────────

  @Get(':institutionId/usage')
  @UseGuards(AuthTenantGuard)
  async getUsageSummary(
    @Param('institutionId') institutionId: string,
    @Query('month') month?: string,
  ) {
    return this.usageMetering.getUsageSummary(institutionId, month);
  }

  // ─── Phase VII: Data Privacy (MP-041) ─────────────────────────

  @Get('privacy/inventory')
  @UseGuards(AuthTenantGuard)
  async getDataInventory() {
    return this.dataPrivacy.getDataInventory();
  }

  @Post(':institutionId/privacy/deletion-request')
  @UseGuards(AuthTenantGuard)
  async requestDeletion(
    @Req() req: any,
    @Param('institutionId') institutionId: string,
    @Body() body: { regulation: string; scope?: string },
  ) {
    return this.dataPrivacy.requestDeletion(
      institutionId,
      req.user.userId,
      body.regulation as any,
      body.scope as any,
    );
  }

  @Get(':institutionId/privacy/sar')
  @UseGuards(AuthTenantGuard)
  async generateSAR(@Req() req: any) {
    return this.dataPrivacy.generateSAR(req.user.userId);
  }

  // ─── MP-006: Smart CSV Ingest v2 ────────────────────────────────

  @Post(':institutionId/ingest/smart/analyze')
  @UseGuards(AuthTenantGuard)
  async analyzeCSV(
    @Param('institutionId') institutionId: string,
    @Body() body: { csvContent: string },
  ) {
    return this.csvIngestV2.analyzeCSV(institutionId, body.csvContent);
  }

  @Post(':institutionId/ingest/smart/commit')
  @UseGuards(AuthTenantGuard)
  async commitSmartIngest(
    @Param('institutionId') institutionId: string,
    @Body()
    body: {
      csvContent: string;
      mappings: Record<string, string>;
      saveMappings?: boolean;
    },
  ) {
    return this.csvIngestV2.commitIngestion(
      institutionId,
      body.csvContent,
      body.mappings,
      body.saveMappings,
    );
  }

  // ─── MP-020: NIM Optimizer ─────────────────────────────────────

  @Get(':institutionId/nim-optimizer')
  @UseGuards(AuthTenantGuard)
  async getNIMOptimizer(@Param('institutionId') institutionId: string) {
    return this.nimOptimizer.optimize(institutionId);
  }

  // ─── MP-021: Key-Rate Durations ────────────────────────────────

  @Get(':institutionId/key-rate-durations')
  @UseGuards(AuthTenantGuard)
  async getKeyRateDurations(@Param('institutionId') institutionId: string) {
    return this.keyRateDuration.analyzePortfolio(institutionId);
  }

  // ─── MP-023: Liquidity Transfer Pricing ────────────────────────

  @Get(':institutionId/ltp')
  @UseGuards(AuthTenantGuard)
  async getLTP(@Param('institutionId') institutionId: string) {
    return this.ltp.computeLTP(institutionId);
  }

  // ─── MP-033: USVI Expansion ────────────────────────────────────

  @Get('usvi/framework')
  @UseGuards(AuthTenantGuard)
  async getUSVIFramework() {
    return this.usviExpansion.getUSVIFramework();
  }

  // ─── V6+V7: Regulatory Alerts (MP-200) ─────────────────────────

  @Get(':institutionId/alerts')
  @UseGuards(AuthTenantGuard)
  async getAlerts(
    @Param('institutionId') institutionId: string,
    @Query('unreadOnly') unread?: string,
  ) {
    return this.alertDelivery.getInstitutionAlerts(
      institutionId,
      unread === 'true',
    );
  }

  @Post(':institutionId/alerts/:alertId/read')
  @UseGuards(AuthTenantGuard)
  async markAlertRead(@Param('alertId') alertId: string) {
    return this.alertDelivery.markRead(alertId);
  }

  @Post(':institutionId/alerts/:alertId/dismiss')
  @UseGuards(AuthTenantGuard)
  async dismissAlert(@Param('alertId') alertId: string) {
    return this.alertDelivery.dismiss(alertId);
  }

  @Get('regulatory/publications')
  @UseGuards(AuthTenantGuard)
  async getPublications() {
    return this.regAlert.getRecentPublications();
  }

  @Post('regulatory/scan-now')
  @UseGuards(AuthTenantGuard)
  async triggerRegScan() {
    return this.regAlert.runFullPipeline();
  }

  // ─── V6+V7: CAMEL Forecaster (MP-201) ────────────────────────

  @Get(':institutionId/camel-forecast')
  @UseGuards(AuthTenantGuard)
  async getCamelForecast(@Param('institutionId') institutionId: string) {
    return this.camelForecaster.forecastForInstitution(institutionId);
  }

  // ─── V6+V7: NL Document Ingest (MP-202) ──────────────────────

  @Post(':institutionId/ingest/nl')
  @UseGuards(AuthTenantGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async nlDocumentIngest(
    @Param('institutionId') institutionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.nlIngest.ingestDocument(
      institutionId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
  }

  // ─── V6+V7: Peer Synthesis (MP-203) ──────────────────────────

  @Get('peer-synthesis/latest')
  @UseGuards(AuthTenantGuard)
  async getPeerSynthesis() {
    return this.peerSynthesis.getLatestReport();
  }

  // ─── V6+V7: DFAST Stress v2 (MP-204) ─────────────────────────

  @Get('stress-v2/presets')
  @UseGuards(AuthTenantGuard)
  async getStressV2Presets() {
    return this.stressV2.getPresetScenarios();
  }

  @Post(':institutionId/stress-v2/run')
  @UseGuards(AuthTenantGuard)
  async runStressV2(
    @Param('institutionId') institutionId: string,
    @Body() body: { scenarioId?: string },
  ) {
    const presets = this.stressV2.getPresetScenarios();
    const scenario = body.scenarioId
      ? (presets.find((p) => p.id === body.scenarioId) ?? presets[0])
      : presets[0];
    return this.stressV2.runStressTest(institutionId, scenario);
  }

  @Post(':institutionId/stress-v2/run-all')
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 runs per minute — runs all scenarios
  @UseGuards(AuthTenantGuard)
  async runAllStressV2(@Param('institutionId') institutionId: string) {
    return this.stressV2.runAllPresets(institutionId);
  }

  // ─── V6+V7: Robust Optimizer (MP-205) ────────────────────────

  @Post(':institutionId/robust-optimize')
  @UseGuards(AuthTenantGuard)
  async robustOptimize(
    @Param('institutionId') institutionId: string,
    @Body()
    body: { aggressiveness?: 'conservative' | 'moderate' | 'aggressive' },
  ) {
    return this.robustOptimizer.optimize(institutionId, body.aggressiveness);
  }

  // ─── V6+V7: Optionality Suite (MP-206) ───────────────────────

  @Get(':institutionId/optionality')
  @UseGuards(AuthTenantGuard)
  async getOptionality(@Param('institutionId') institutionId: string) {
    return this.optionalitySuite.analyzePortfolio(institutionId);
  }

  // ─── V6+V7: Credit Concentration VaR (MP-207) ────────────────

  @Get(':institutionId/concentration-var')
  @UseGuards(AuthTenantGuard)
  async getConcVaR(@Param('institutionId') institutionId: string) {
    return this.creditConcVaR.compute(institutionId);
  }

  // ─── V6+V7: Demo Workspace (MP-217) ──────────────────────────

  @Post('demo/build')
  @UseGuards(AuthTenantGuard)
  async buildDemoWorkspace(
    @Body() body: { charterNumber: string; demoLabel: string },
  ) {
    return this.demoWorkspace.buildWorkspace(
      body.charterNumber,
      body.demoLabel,
    );
  }

  // ─── V6+V7: Onboarding (MP-222) ──────────────────────────────

  @Get(':institutionId/onboarding')
  @UseGuards(AuthTenantGuard)
  async getOnboardingStatus(@Param('institutionId') institutionId: string) {
    return this.onboardingOrchestrator.getOnboardingStatus(institutionId);
  }

  @Get('admin/onboarding-statuses')
  @UseGuards(AuthTenantGuard)
  async getAllOnboardingStatuses() {
    return this.onboardingOrchestrator.getAllOnboardingStatuses();
  }

  // ─── V8: Climate Risk (MP-307) ──────────────────────────────────

  @Get(':institutionId/climate-risk')
  @UseGuards(AuthTenantGuard)
  async getClimateRisk(@Param('institutionId') institutionId: string) {
    return this.climateRisk.computeClimateRisk(institutionId);
  }

  // ─── V8: NIM Attribution (MP-308) ─────────────────────────────

  @Get(':institutionId/nim-attribution')
  @UseGuards(AuthTenantGuard)
  async getNIMAttribution(@Param('institutionId') institutionId: string) {
    return this.nimAttribution.computeAttribution(institutionId);
  }

  // ─── V8: Behavioral Duration (MP-309) ─────────────────────────

  @Get(':institutionId/behavioral-duration')
  @UseGuards(AuthTenantGuard)
  async getBehavioralDuration(@Param('institutionId') institutionId: string) {
    return this.behavioralDuration.computeBehavioralDurations(institutionId);
  }

  // ─── V9: HMM Macro Regime (MP-431) ───────────────────────────

  @Get('market/macro-regime')
  @UseGuards(AuthTenantGuard)
  async getMacroRegime() {
    // D1 (never silent zeros): the prior implementation fed a SYNTHETIC sine-wave
    // rate series and presented the resulting "regime" as real. No real
    // rate-history pipeline is wired yet, so report data_unavailable honestly
    // rather than fabricate a macro regime — detectRegime([]) returns the honest
    // insufficient-data shell. (Wire a real FED_FUNDS/Treasury time series from
    // MarketDataSnapshot to light this up.)
    return this.hmmRegime.detectRegime([]);
  }

  // ─── V9: Black-Litterman Portfolio ──────────────────────────────

  // ── GET alias for the panel ────────────────────────────────────
  //
  // `<AlmPage slug=...>` — the wrapper every ALM panel is built on — issues a
  // GET against the registry endpoint and has no `method`/`body` prop at all.
  // A POST-only analytic therefore renders as a dead panel: the page returns
  // 200 and its data call 404s. That is exactly how several panels shipped broken.
  //
  // Every parameter on the POST body below is optional and already defaulted
  // by the service, so a GET that runs with defaults is well-defined. The POST
  // stays for parameterized runs. Same shape as the existing `@Get(hrp)` route.
  @Get(':institutionId/black-litterman')
  @UseGuards(AuthTenantGuard)
  async getBlackLitterman(@Param('institutionId') id: string) {
    return this.blackLitterman.computeBLPortfolio(id);
  }

  @Post(':institutionId/black-litterman')
  @UseGuards(AuthTenantGuard)
  async runBlackLitterman(
    @Param('institutionId') id: string,
    @Body() body: { views?: any[] },
  ) {
    return this.blackLitterman.computeBLPortfolio(id, body.views);
  }

  // ─── V9: CVaR Portfolio Optimizer ─────────────────────────────

  // GET alias for the panel — see the black-litterman alias above. Carries
  // the same throttle as the POST: it runs the identical solver.
  @Get(':institutionId/cvar-optimize')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @UseGuards(AuthTenantGuard)
  async getCVaROptimizer(@Param('institutionId') id: string) {
    return this.cvarOptimizer.optimize(id);
  }

  @Post(':institutionId/cvar-optimize')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 runs per minute — optimization solver
  @UseGuards(AuthTenantGuard)
  async runCVaROptimizer(
    @Param('institutionId') id: string,
    @Body() body: { alpha?: number },
  ) {
    return this.cvarOptimizer.optimize(id, body.alpha);
  }

  // ─── V9: Hierarchical Risk Parity ─────────────────────────────

  @Get(':institutionId/hrp')
  @UseGuards(AuthTenantGuard)
  async getHRP(@Param('institutionId') id: string) {
    return this.hrpService.computeHRP(id);
  }

  // ─── V9: CreditMetrics Migration ──────────────────────────────

  @Post(':institutionId/credit-metrics')
  @UseGuards(AuthTenantGuard)
  async runCreditMetrics(
    @Param('institutionId') id: string,
    @Body() body: { paths?: number },
  ) {
    return this.creditMetricsSvc.computePortfolioVaR(id, body.paths);
  }

  // ─── V9: KMV-Merton Structural Default ────────────────────────

  @Get(':institutionId/kmv-merton')
  @UseGuards(AuthTenantGuard)
  async getKMVMerton(@Param('institutionId') id: string) {
    return this.kmvMerton.computeKMV(id);
  }

  // ─── V9: PCA Yield Curve Factors ──────────────────────────────

  @Get(':institutionId/pca-factors')
  @UseGuards(AuthTenantGuard)
  async getPCAFactors(@Param('institutionId') _id: string) {
    // D1 (never silent zeros): the prior implementation fed SYNTHETIC yield
    // changes generated from a hardcoded base curve and presented the resulting
    // PCA factors as real. No real YieldCurve-history pipeline is wired yet, so
    // report data_unavailable honestly rather than fabricate factor loadings —
    // computePCAFactors([]) returns the honest insufficient-data shell. (Wire a
    // real per-institution YieldCurve time series to light this up.)
    return this.pcaYieldCurve.computePCAFactors([]);
  }

  // ─── V9: FRTB Expected Shortfall ──────────────────────────────

  @Get(':institutionId/frtb-capital')
  @UseGuards(AuthTenantGuard)
  async getFRTBCapital(@Param('institutionId') id: string) {
    return this.frtbES.computeFRTBCapital(id);
  }

  // ─── V9: Fed Funds Futures ────────────────────────────────────

  @Get('market/fed-futures')
  @UseGuards(AuthTenantGuard)
  async getFedFutures() {
    return this.fedFutures.computeFedFuturesCurve();
  }

  // ─── V9: Macro Factor Model ───────────────────────────────────

  @Get(':institutionId/macro-factors')
  @UseGuards(AuthTenantGuard)
  async getMacroFactors(@Param('institutionId') id: string) {
    return this.macroFactor.computeMacroImpact(id);
  }

  // ─── V9+: Copula Credit ────────────────────────────────────────

  @Post(':institutionId/copula-credit')
  @UseGuards(AuthTenantGuard)
  async runCopulaCredit(
    @Param('institutionId') id: string,
    @Body() body: { type?: string; paths?: number },
  ) {
    return this.copulaCredit.simulateWithCopula(
      id,
      (body.type as any) ?? 'gaussian',
      5,
      body.paths,
    );
  }

  // ─── V9+: Wrong-Way Risk ─────────────────────────────────────

  @Get(':institutionId/wrong-way-risk')
  @UseGuards(AuthTenantGuard)
  async getWrongWayRisk(@Param('institutionId') id: string) {
    return this.wrongWayRisk.computeWWR(id);
  }

  // ─── V9+: IR Cap/Floor Pricer ─────────────────────────────────

  @Post('derivatives/cap-floor')
  @UseGuards(AuthTenantGuard)
  async priceCapFloor(
    @Body()
    body: {
      type: 'cap' | 'floor';
      notional: number;
      strike: number;
      vol?: number;
    },
  ) {
    const fwdRates = [0.048, 0.046, 0.044, 0.042, 0.041, 0.04, 0.04, 0.041];
    const dfs = fwdRates.map((_, i) => Math.exp(-0.042 * (i + 1) * 0.25));
    return this.irCapFloor.priceCapFloor(
      body.type,
      body.notional,
      body.strike,
      fwdRates,
      body.vol ?? 0.2,
      dfs,
    );
  }

  // ─── V9+: NCUA RBC2 ──────────────────────────────────────────

  @Get(':institutionId/rbc2')
  @UseGuards(AuthTenantGuard)
  async getRBC2(@Param('institutionId') id: string) {
    return this.ncuaRBC2.computeRBC2(id);
  }

  // ─── MP-034: Reseller Portal ────────────────────────────────────

  @Post('resellers')
  @UseGuards(AuthTenantGuard)
  async createReseller(
    @Body()
    body: {
      name: string;
      slug: string;
      logoUrl?: string;
      revenueSharePct: number;
      domain?: string;
    },
  ) {
    return this.reseller.createReseller(body);
  }

  @Get('resellers')
  @UseGuards(AuthTenantGuard)
  async listResellers() {
    return this.reseller.listResellers();
  }

  @Get('resellers/:id')
  @UseGuards(AuthTenantGuard)
  async getReseller(@Param('id') id: string) {
    return this.reseller.getReseller(id);
  }

  // ─── Sample Report Factory ──────────────────────────────────────

  @Post('sample-report')
  @UseGuards(AuthTenantGuard)
  async generateSampleReport(
    @Body() body: { charterNumber: string; lang?: string },
    @Res() res: any,
  ) {
    this.logger.log(
      `Sample report requested for charter ${body.charterNumber}`,
    );
    const document = await this.documentExports.generateSampleExport(
      body.charterNumber,
      body.lang === 'es' ? 'es' : 'en',
    );
    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  @Get('sample-report/:charterNumber/exports')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'List export manifests for sample report documents',
  })
  async listSampleReportExports(@Param('charterNumber') charterNumber: string) {
    return this.documentExports.listSampleExports(charterNumber);
  }

  @Get('sample-report/:charterNumber')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({
    summary: 'Download a sample report document as PDF',
  })
  async downloadSampleReport(
    @Param('charterNumber') charterNumber: string,
    @Query('lang') lang: string,
    @Res() res: any,
  ) {
    const document = await this.documentExports.generateSampleExport(
      charterNumber,
      lang === 'es' ? 'es' : 'en',
    );
    res.set(buildPdfResponseHeaders(document.manifest, document.buffer.length));
    res.end(document.buffer);
  }

  @Post('sample-report/prospect')
  @UseGuards(AuthTenantGuard)
  async generateSampleForProspect(
    @Body() body: { charterNumber: string; prospectId: string },
  ) {
    return this.sampleReportFactory.generateAndSaveForProspect(
      body.charterNumber,
      body.prospectId,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  Stateless Endpoints (existing — no auth, POST-based)
  // ═══════════════════════════════════════════════════════════════

  @Post('duration-gap')
  durationGap(@Body() dto: ScenarioRequestDto): DurationGapResult {
    this.logger.log('Duration gap analysis requested');
    return this.almService.durationGapAnalysis(dto.balanceSheet);
  }

  @Post('nii-simulation')
  niiSimulation(@Body() dto: ScenarioRequestDto): NIIResult {
    this.logger.log('NII simulation requested');
    return this.almService.niiSimulation(dto.balanceSheet, dto.rateShocks);
  }

  @Post('eve')
  eve(@Body() dto: ScenarioRequestDto): EVEResult {
    this.logger.log('EVE analysis requested');
    return this.almService.eveAnalysis(dto.balanceSheet, dto.rateShocks);
  }

  @Post('lcr')
  lcr(@Body() dto: LCRRequestDto): LCRResult {
    this.logger.log('LCR computation requested');
    return this.almService.liquidityCoverageRatio(dto);
  }

  @Post('bpv')
  bpv(@Body() dto: ScenarioRequestDto): BPVResult {
    this.logger.log('BPV analysis requested');
    return this.almService.basisPointValue(dto.balanceSheet);
  }

  @Post('full-analysis')
  fullAnalysis(@Body() dto: FullAnalysisRequestDto): FullAnalysisResult {
    this.logger.log('Full ALM analysis requested');
    return this.almService.fullAnalysis(
      dto.balanceSheet,
      dto.rateShocks,
      dto.lcr,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  Historical Trend API
  // ═══════════════════════════════════════════════════════════════

  @Get(':institutionId/trend')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({ summary: 'Get historical trend of key ALM metrics' })
  @ApiParam({ name: 'institutionId', description: 'Institution ID' })
  @ApiResponse({ status: 200, description: 'Historical trend time series' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getHistoricalTrend(@Param('institutionId') institutionId: string) {
    this.logger.log(
      `Historical trend requested for institution ${institutionId}`,
    );
    return this.trendAnalysis.getHistoricalTrend(institutionId);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Data Export API
  // ═══════════════════════════════════════════════════════════════

  @Get(':institutionId/export/json')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({ summary: 'Export latest ALM metrics as JSON' })
  @ApiParam({ name: 'institutionId', description: 'Institution ID' })
  @ApiResponse({ status: 200, description: 'JSON metrics export' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No completed analysis found' })
  async exportJSON(@Param('institutionId') id: string) {
    this.logger.log(`JSON export requested for institution ${id}`);
    return this.dataExport.exportMetrics(id, 'json');
  }

  @Get(':institutionId/export/csv')
  @UseGuards(AuthTenantGuard)
  @ApiOperation({ summary: 'Export latest ALM metrics as CSV' })
  @ApiParam({ name: 'institutionId', description: 'Institution ID' })
  @ApiResponse({
    status: 200,
    description: 'CSV file download',
    content: { 'text/csv': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No completed analysis found' })
  async exportCSV(@Param('institutionId') id: string, @Res() res: any) {
    this.logger.log(`CSV export requested for institution ${id}`);
    const csv = await this.dataExport.exportMetrics(id, 'csv');
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="cerniq-metrics.csv"',
    });
    res.send(csv);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Demo / Static Endpoints
  // ═══════════════════════════════════════════════════════════════

  @Get('demo-balance-sheet')
  demoBalanceSheet(): BalanceSheetDto {
    this.logger.log('Demo balance sheet requested');
    return this.almService.getDemoBalanceSheet();
  }

  @Get('demo-analysis')
  demoAnalysis(): FullAnalysisResult {
    this.logger.log('Demo full analysis requested');
    const bs = this.almService.getDemoBalanceSheet();
    return this.almService.fullAnalysis(bs);
  }
}
