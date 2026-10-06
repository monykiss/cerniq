import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActionsModule } from '../actions/actions.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { AlmActionsBootstrap } from '../actions/alm-actions.bootstrap';
import { AlmService } from './alm.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { AlmAdvisorService } from './alm-advisor.service';
import { StressTestingService } from './stress-testing/stress-testing.service';
import { ReportsService } from './reports/reports.service';
import { ReportPreflightService } from './reports/report-preflight.service';
import { ReportArtifactService } from './reports/report-artifact.service';
import { ReportArtifactController } from './reports/report-artifact.controller';
import { CossecReportService } from './reports/cossec-report.service';
import { WorkspaceOnboardingService } from './workspace-onboarding.service';
import { InstitutionSeedService } from './institution-seed.service';
import { MarketRegistrySeedService } from './market-registry-seed.service';
import { CSVIngestionService } from './csv-ingestion.service';
import { CsvSchemaInferenceService } from './csv-schema-inference.service';
import { AnalysisRunsService } from './analysis-runs.service';
import { IngestionLogsService } from './ingestion-logs.service';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { DurationService } from './duration.service';
// Phase I-III services
import { ScenarioPersistenceService } from './scenarios/scenario-persistence.service';
import { YieldCurveService } from './yield-curve.service';
import { CECLService } from './cecl.service';
import { MacroOverlayService } from './macro-overlay.service';
import { PrMacroFeedService } from './pr-macro-feed.service';
import { CaelComplianceService } from './cael-compliance.service';
import { CaelArtifactService } from './cael-artifact.service';
import { FTPService } from './ftp.service';
import { DepositBetaService } from './deposit-beta.service';
import { LiquidityAdvancedService } from './liquidity-advanced.service';
import { ConcentrationService } from './concentration.service';
import { NCUADataPullService } from './data-pull/ncua-data-pull.service';
import { CossecDataPullService } from './data-pull/cossec-data-pull.service';
import { SampleReportFactoryService } from './sample-report-factory.service';
// Phase IV services
import { AlmAdvisorV2Service } from './alm-advisor-v2.service';
import { LiquidityStressPackService } from './liquidity-stress-pack.service';
import { IRRPolicyService } from './irr-policy.service';
import { DepositBetaLibraryService } from './deposit-beta-library.service';
import { RepricingGapService } from './repricing-gap.service';
import { FTPAttributionService } from './ftp-attribution.service';
import { ForwardSimulationService } from './forward-simulation.service';
import { PeerAnalyticsService } from './peer-analytics.service';
import { CECLVintageService } from './cecl-vintage.service';
import { MonteCarloService } from './monte-carlo.service';
// Phase V services
import { OASCalculatorService } from './oas-calculator.service';
import { CreditRiskQuantService } from './credit-risk-quant.service';
import { PortfolioVaRService } from './portfolio-var.service';
import { CapitalOptimizerService } from './capital-optimizer.service';
import { AssetEWSService } from './asset-ews.service';
import { PrepaymentEngineService } from './prepayment-engine.service';
import { SOFRMonitorService } from './sofr-monitor.service';
import { TreasuryRatesService } from './treasury-rates.service';
// Phase VI services
import { CAMELScorerService } from './exam-prep/camel-scorer.service';
import { ExamPrepService } from './exam-prep/exam-prep.service';
import { CAMELCertificationService } from './exam-prep/camel-certification.service';
import { CAMELCertificationController } from './exam-prep/camel-certification.controller';
import { BoardReportService } from './board-report.service';
import { ChatAnalystService } from './chat-analyst.service';
import { NCUA5300Service } from './ncua-5300.service';
import { NetworkIntelligenceService } from './network-intelligence.service';
import { WebhookService } from './webhook.service';
import { UsageMeteringService } from './usage-metering.service';
import { DataPrivacyService } from './data-privacy.service';
// Gap-closing services
import { CsvIngestV2Service } from './csv-ingest-v2.service';
import { NIMOptimizerService } from './nim-optimizer.service';
import { KeyRateDurationService } from './key-rate-duration.service';
import { LiquidityTransferPricingService } from './liquidity-transfer-pricing.service';
import { USVIExpansionService } from './usvi-expansion.service';
import { ResellerService } from './reseller.service';
// V6+V7 next-wave services
import { RegulatoryAlertService } from '../ai/regulatory/regulatory-alert.service';
import { RegulatoryScraperService } from '../ai/regulatory/regulatory-scraper.service';
import { ImpactExtractorService } from '../ai/regulatory/impact-extractor.service';
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
// V8+V9 high-impact
import { ClimateRiskService } from './climate-risk.service';
import { NIMAttributionService } from './nim-attribution.service';
import { BehavioralDurationService } from './behavioral-duration.service';
import { AICostControllerService } from '../ai/cost-controller.service';
import { HMMRegimeService } from './hmm-regime.service';
// V9 Quant Frontier
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
// Trend + Export services
import { TrendAnalysisService } from './trend-analysis.service';
import { DataExportService } from './data-export.service';
// Custom Scenario & Excel Export
import { CustomScenarioService } from './custom-scenario.service';
import { ExcelExportService } from './excel-export.service';
import { PreviewReportService } from './preview-report.service';
import { AlmDocumentExportsService } from './alm-document-exports.service';
// Controllers
import { AlmController } from './alm.controller';
import { CaelController } from './cael.controller';
import { EwsController } from './ews/ews.controller';
import { LoanTapeController } from './loan-tape/loan-tape.controller';
import { LoanTapeIngestService } from './loan-tape/loan-tape-ingest.service';
import { LoanTapeAggregationService } from './loan-tape/loan-tape-aggregation.service';
import { GeographicConcentrationService } from './loan-tape/geographic-concentration.service';
import { FhlbnyCollateralService } from './loan-tape/fhlbny-collateral.service';
import { EwsSnapshotService } from './ews/ews-snapshot.service';
import { EwsSchedulerService } from './ews/ews-scheduler.service';
import { Member360Controller } from './member360/member-360.controller';
import { Member360Service } from './member360/member-360.service';
import { LoanLifecycleService } from './member360/loan-lifecycle.service';
import { MemberBookFromTapeService } from './member360/member-book-from-tape.service';
import { MemberFixtureService } from './member360/member-fixture.service';
import { MemberLifecycleService } from './member360/member-lifecycle.service';
import { AlmAdvisorController } from './alm-advisor.controller';
import { AlmAdvisorV2Controller } from './alm-advisor-v2.controller';
import { AlmAnalystService } from './alm-analyst.service';
import { AlmAnalystController } from './alm-analyst.controller';
import { AuthGuard } from '../auth/auth.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
// Agent tool-layer services (wired into AlmToolsFactory)
import { DepositDecayService } from './deposit-decay.service';
import { DepositPricingEngineService } from './deposit-pricing-engine.service';
import { CostOfFundsService } from './cost-of-funds.service';
import { UdepositUmixUoptimizerService } from './deposit-mix-optimizer.service';
import { MaturityLadderService } from './maturity-ladder.service';
import { CapitalAdequacyRatioService } from './capital-adequacy-ratio.service';
// Quant engine modules
import { HJMModule } from './quant/hjm.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
    // Phase 3 (2026-04-07): import the action registry so AlmActionsBootstrap
    // can register the first wave of ALM actions on module init.
    ActionsModule,
    // HJM two-factor forward curve engine (calibration + Monte Carlo + NestJS services)
    HJMModule,
    // FAANG Audit P1: model governance registry for report lineage
    ModelRegistryModule,
  ],
  controllers: [
    EwsController,
    LoanTapeController,
    Member360Controller,
    AlmController,
    CaelController,
    AlmAdvisorController,
    AlmAdvisorV2Controller,
    AlmAnalystController,
    CAMELCertificationController,
    ReportArtifactController,
  ],
  providers: [
    // Phase 3: AlmActionsBootstrap implements OnModuleInit and registers
    // institution.seed and alm.preflight as the first wave. Adding more
    // actions: edit src/actions/alm-actions.bootstrap.ts.
    AlmActionsBootstrap,
    // Core
    AlmService,
    AlmEnterpriseService,
    AlmAdvisorService,
    StressTestingService,
    ReportsService,
    ReportPreflightService,
    ReportArtifactService,
    CossecReportService,
    WorkspaceOnboardingService,
    InstitutionSeedService,
    MarketRegistrySeedService,
    CSVIngestionService,
    CsvSchemaInferenceService,
    AnalysisRunsService,
    IngestionLogsService,
    ComplianceCalendarService,
    DurationService,
    // Phase I-III
    ScenarioPersistenceService,
    YieldCurveService,
    CECLService,
    MacroOverlayService,
    PrMacroFeedService,
    CaelComplianceService,
    CaelArtifactService,
    FTPService,
    DepositBetaService,
    LiquidityAdvancedService,
    ConcentrationService,
    NCUADataPullService,
    CossecDataPullService,
    SampleReportFactoryService,
    // Phase IV
    AlmAdvisorV2Service,
    LiquidityStressPackService,
    IRRPolicyService,
    DepositBetaLibraryService,
    RepricingGapService,
    FTPAttributionService,
    ForwardSimulationService,
    PeerAnalyticsService,
    CECLVintageService,
    MonteCarloService,
    // Phase V
    OASCalculatorService,
    CreditRiskQuantService,
    PortfolioVaRService,
    CapitalOptimizerService,
    AssetEWSService,
    EwsSnapshotService,
    EwsSchedulerService,
    LoanTapeIngestService,
    LoanTapeAggregationService,
    GeographicConcentrationService,
    FhlbnyCollateralService,
    Member360Service,
    MemberFixtureService,
    MemberLifecycleService,
    LoanLifecycleService,
    MemberBookFromTapeService,
    PrepaymentEngineService,
    SOFRMonitorService,
    TreasuryRatesService,
    // Phase VI
    CAMELScorerService,
    ExamPrepService,
    CAMELCertificationService,
    BoardReportService,
    ChatAnalystService,
    NCUA5300Service,
    NetworkIntelligenceService,
    WebhookService,
    UsageMeteringService,
    DataPrivacyService,
    CsvIngestV2Service,
    NIMOptimizerService,
    KeyRateDurationService,
    LiquidityTransferPricingService,
    USVIExpansionService,
    ResellerService,
    // V6+V7 next-wave
    RegulatoryAlertService,
    RegulatoryScraperService,
    ImpactExtractorService,
    AlertDeliveryService,
    CamelForecasterService,
    NLIngestService,
    PeerSynthesisService,
    StressV2Service,
    RobustOptimizerService,
    OptionalitySuiteService,
    CreditConcentrationVaRService,
    DemoWorkspaceService,
    OnboardingOrchestratorService,
    ClimateRiskService,
    NIMAttributionService,
    BehavioralDurationService,
    AICostControllerService,
    HMMRegimeService,
    BlackLittermanService,
    CVaROptimizerService,
    HRPService,
    CreditMetricsService,
    KMVMertonService,
    PCAYieldCurveService,
    FRTBESService,
    FedFuturesService,
    MacroFactorModelService,
    CopulaCreditService,
    WrongWayRiskService,
    IRCapFloorService,
    NCUARBC2Service,
    // Trend + Export
    TrendAnalysisService,
    DataExportService,
    // Custom Scenario & Excel Export
    CustomScenarioService,
    ExcelExportService,
    PreviewReportService,
    AlmDocumentExportsService,
    AlmAnalystService,
    // Agent tool-layer services
    DepositDecayService,
    DepositPricingEngineService,
    CostOfFundsService,
    UdepositUmixUoptimizerService,
    MaturityLadderService,
    CapitalAdequacyRatioService,
    // Guards
    AuthGuard,
    // Per-resource ownership guard — reuses the same impl as agent-api so
    // analyst routes get an explicit 403 on cross-tenant access instead of
    // relying on RLS-induced silent empty results.
    InstitutionScopeGuard,
  ],
  exports: [
    AlmService,
    AlmEnterpriseService,
    AlmAdvisorService,
    StressTestingService,
    ReportsService,
    ReportPreflightService,
    ReportArtifactService,
    CossecReportService,
    WorkspaceOnboardingService,
    InstitutionSeedService,
    MarketRegistrySeedService,
    CSVIngestionService,
    CsvSchemaInferenceService,
    AnalysisRunsService,
    IngestionLogsService,
    ComplianceCalendarService,
    DurationService,
    ScenarioPersistenceService,
    YieldCurveService,
    CECLService,
    MacroOverlayService,
    PrMacroFeedService,
    CaelComplianceService,
    CaelArtifactService,
    FTPService,
    DepositBetaService,
    LiquidityAdvancedService,
    ConcentrationService,
    NCUADataPullService,
    CossecDataPullService,
    SampleReportFactoryService,
    AlmAdvisorV2Service,
    LiquidityStressPackService,
    IRRPolicyService,
    DepositBetaLibraryService,
    RepricingGapService,
    FTPAttributionService,
    ForwardSimulationService,
    PeerAnalyticsService,
    CECLVintageService,
    MonteCarloService,
    OASCalculatorService,
    CreditRiskQuantService,
    PortfolioVaRService,
    CapitalOptimizerService,
    AssetEWSService,
    EwsSnapshotService,
    Member360Service,
    MemberFixtureService,
    MemberLifecycleService,
    LoanLifecycleService,
    MemberBookFromTapeService,
    PrepaymentEngineService,
    SOFRMonitorService,
    TreasuryRatesService,
    CAMELScorerService,
    ExamPrepService,
    CAMELCertificationService,
    BoardReportService,
    ChatAnalystService,
    NCUA5300Service,
    NetworkIntelligenceService,
    WebhookService,
    UsageMeteringService,
    DataPrivacyService,
    CsvIngestV2Service,
    NIMOptimizerService,
    KeyRateDurationService,
    LiquidityTransferPricingService,
    USVIExpansionService,
    ResellerService,
    RegulatoryAlertService,
    RegulatoryScraperService,
    ImpactExtractorService,
    AlertDeliveryService,
    CamelForecasterService,
    NLIngestService,
    PeerSynthesisService,
    StressV2Service,
    RobustOptimizerService,
    OptionalitySuiteService,
    CreditConcentrationVaRService,
    DemoWorkspaceService,
    OnboardingOrchestratorService,
    ClimateRiskService,
    NIMAttributionService,
    BehavioralDurationService,
    AICostControllerService,
    HMMRegimeService,
    BlackLittermanService,
    CVaROptimizerService,
    HRPService,
    CreditMetricsService,
    KMVMertonService,
    PCAYieldCurveService,
    FRTBESService,
    FedFuturesService,
    MacroFactorModelService,
    CopulaCreditService,
    WrongWayRiskService,
    IRCapFloorService,
    NCUARBC2Service,
    TrendAnalysisService,
    DataExportService,
    CustomScenarioService,
    ExcelExportService,
    PreviewReportService,
    AlmDocumentExportsService,
    AlmAnalystService,
    DepositDecayService,
    DepositPricingEngineService,
    CostOfFundsService,
    UdepositUmixUoptimizerService,
    MaturityLadderService,
    CapitalAdequacyRatioService,
  ],
})
export class AlmModule {}
