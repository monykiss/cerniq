import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ALMSummaryResult,
  AlmEnterpriseService,
  COSSECComplianceResult,
} from '../alm-enterprise.service';
import {
  StressTestResult,
  StressTestingService,
} from '../stress-testing/stress-testing.service';
import {
  asNumber,
  createReportFormatter,
  inferMoneyScale,
  REPORT_THEME,
  ReportLanguage,
  toneFromStatus,
} from './report-formatting';
import { ReportArtifactService } from './report-artifact.service';
import { ReportPreflightService } from './report-preflight.service';
import type { ArtifactRecord } from './report-artifact.service';

const PDFDocument = require('pdfkit');

type ReportTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface ReportMetric {
  label: string;
  value: string;
  helper?: string | null;
  tone?: ReportTone;
}

interface ReportRecommendation {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
}

interface ReportTableRow {
  cells: string[];
  tone?: ReportTone;
}

interface SectionState<T> {
  available: boolean;
  note: string | null;
  data: T | null;
}

interface BalanceSheetSection {
  summaryRows: ReportTableRow[];
  assetRows: ReportTableRow[];
  liabilityRows: ReportTableRow[];
}

interface InterestRateSection {
  narrative: string;
  metricRows: ReportTableRow[];
  scenarioRows: ReportTableRow[];
}

interface LiquidityStressSection {
  liquidityNarrative: string;
  liquidityRows: ReportTableRow[];
  hqlaRows: ReportTableRow[];
  stressOverviewRows: ReportTableRow[];
  regulatoryStressRows: ReportTableRow[];
}

interface RegulatorySection {
  statusLabel: string;
  statusTone: ReportTone;
  summaryRows: ReportTableRow[];
  checkRows: ReportTableRow[];
  notes: string[];
}

interface ALMReportPayload {
  lang: ReportLanguage;
  formatter: ReturnType<typeof createReportFormatter>;
  institutionName: string;
  institutionTypeLabel: string;
  currency: string;
  primaryRegulator: string;
  reportId: string;
  generatedAtLabel: string;
  reportingPeriodLabel: string;
  assetsMetric: { exact: string; compact: string | null };
  executiveHeadline: string;
  executiveNarrative: string;
  overviewMetrics: ReportMetric[];
  keyRisks: string[];
  recommendations: ReportRecommendation[];
  availabilityNotes: string[];
  balanceSheet: SectionState<BalanceSheetSection>;
  interestRate: SectionState<InterestRateSection>;
  liquidityStress: SectionState<LiquidityStressSection>;
  regulatory: SectionState<RegulatorySection>;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
    @Optional() private readonly artifactService?: ReportArtifactService,
    @Optional() private readonly preflightService?: ReportPreflightService,
  ) {}

  async generateALMReport(
    institutionId: string,
    language?: string,
    opts?: { watermark?: string },
  ): Promise<Buffer> {
    const lang: ReportLanguage = language === 'es' ? 'es' : 'en';
    this.logger.log(
      `Generating ALM report for institution ${institutionId} (lang=${lang}${opts?.watermark ? ', watermarked' : ''})`,
    );

    const institution = await this.almEnterprise.getInstitution(institutionId);

    const [summaryResult, stressResult, complianceResult] =
      await Promise.allSettled([
        this.almEnterprise.getALMSummary(institutionId),
        this.stressTesting.runFullStressTest(institutionId, {
          paths: 500,
          horizon: 12,
        }),
        this.almEnterprise.getRegulatoryCompliance(institutionId),
      ]);

    const payload = this.buildPayload({
      institution,
      lang,
      summary:
        summaryResult.status === 'fulfilled' ? summaryResult.value : null,
      stress: stressResult.status === 'fulfilled' ? stressResult.value : null,
      compliance:
        complianceResult.status === 'fulfilled' ? complianceResult.value : null,
      summaryError:
        summaryResult.status === 'rejected' ? summaryResult.reason : null,
      stressError:
        stressResult.status === 'rejected' ? stressResult.reason : null,
      complianceError:
        complianceResult.status === 'rejected' ? complianceResult.reason : null,
    });

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'letter',
          margins: { top: 58, bottom: 60, left: 54, right: 54 },
          info: {
            Title: `${payload.institutionName} — CERNIQ ALM Report`,
            Author: 'CERNIQ | KLYTICS',
            Subject:
              lang === 'es'
                ? 'Informe de Gestión de Activos y Pasivos'
                : 'Asset Liability Management Report',
            Keywords: opts?.watermark || 'CERNIQ ALM report',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderCoverPage(doc, payload, opts?.watermark || null);
        this.renderOverviewPage(doc, payload, opts?.watermark || null);
        this.renderBalanceSheetPage(doc, payload, opts?.watermark || null);
        this.renderInterestRatePage(doc, payload, opts?.watermark || null);
        this.renderLiquidityStressPage(doc, payload, opts?.watermark || null);
        this.renderRegulatoryPage(doc, payload, opts?.watermark || null);
        this.renderRecommendationsPage(doc, payload, opts?.watermark || null);

        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Generate an ALM report AND record it as an immutable artifact.
   *
   * Runs preflight first to capture model lineage and gaps, then generates
   * the report buffer, then records the artifact with SHA-256 checksum.
   * Use this instead of `generateALMReport()` when the report will be
   * distributed (portal, exports, action dispatch).
   *
   * Gracefully degrades: if artifact or preflight services are not injected,
   * falls back to raw generation with no artifact recording.
   */
  async generateAndRecordArtifact(
    institutionId: string,
    opts?: {
      language?: string;
      watermark?: string;
      analysisRunId?: string;
      reportJobId?: string;
      storageLocator?: string;
      generatedBy?: string;
    },
  ): Promise<{ buffer: Buffer; artifact?: ArtifactRecord }> {
    const lang = opts?.language === 'es' ? 'es' : 'en';
    const format = lang === 'es' ? 'PDF_ES' : 'PDF_EN';

    // 1. Run preflight (optional — provides model lineage + gaps)
    let modelLineage: any[] = [];
    let preflightGaps: any[] | undefined;
    let preflightReady: boolean | undefined;

    if (this.preflightService) {
      try {
        const preflight = await this.preflightService.check(institutionId);
        modelLineage = preflight.modelLineage;
        preflightGaps = preflight.gaps;
        preflightReady = preflight.ready;
      } catch (err) {
        this.logger.warn({
          event: 'preflight_failed_during_artifact_generation',
          institutionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Generate the report buffer
    const buffer = await this.generateALMReport(
      institutionId,
      opts?.language,
      opts?.watermark ? { watermark: opts.watermark } : undefined,
    );

    // 3. Record the immutable artifact (if service available)
    if (this.artifactService) {
      try {
        const artifact = await this.artifactService.record({
          institutionId,
          analysisRunId: opts?.analysisRunId,
          reportJobId: opts?.reportJobId,
          format: format as any,
          language: lang,
          content: buffer,
          storageLocator:
            opts?.storageLocator ??
            `local://generated/${institutionId}/${format.toLowerCase()}-${Date.now()}`,
          modelLineage,
          preflightGaps,
          preflightReady,
          generatedBy: opts?.generatedBy,
        });

        this.logger.log({
          event: 'report_artifact_recorded',
          institutionId,
          artifactId: artifact.id,
          checksum: artifact.contentChecksum,
          format,
        });

        return { buffer, artifact };
      } catch (err) {
        this.logger.error({
          event: 'artifact_recording_failed',
          institutionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { buffer };
  }

  private buildPayload(input: {
    institution: any;
    lang: ReportLanguage;
    summary: ALMSummaryResult | null;
    stress: StressTestResult | null;
    compliance: COSSECComplianceResult | null;
    summaryError: unknown;
    stressError: unknown;
    complianceError: unknown;
  }): ALMReportPayload {
    const { institution, lang, summary, stress, compliance } = input;
    const items = Array.isArray(institution?.balanceSheetItems)
      ? institution.balanceSheetItems
      : [];
    const assetItems = items.filter((item: any) => item.category === 'asset');
    const liabilityItems = items.filter(
      (item: any) => item.category === 'liability',
    );
    const totalAssetsFromItems = assetItems.reduce(
      (sum: number, item: any) => sum + asNumber(item.balance),
      0,
    );
    const totalLiabilitiesFromItems = liabilityItems.reduce(
      (sum: number, item: any) => sum + asNumber(item.balance),
      0,
    );

    const rawAssetCandidates = [
      institution?.totalAssets,
      summary?.institution?.totalAssets,
      compliance?.summary?.totalAssets,
      totalAssetsFromItems,
      compliance?.summary?.totalLoans,
      compliance?.summary?.liquidAssets,
      summary?.liquidity?.hqla,
      summary?.liquidity?.netOutflows,
      stress?.monteCarlo?.expectedNII,
      stress?.monteCarlo?.worstCaseNII,
    ];

    const moneyScale = inferMoneyScale(rawAssetCandidates);
    const formatter = createReportFormatter(lang, {
      currency:
        institution?.currency || summary?.institution?.currency || 'USD',
      moneyScale,
    });

    const exactAssetsRaw =
      totalAssetsFromItems ||
      asNumber(compliance?.summary?.totalAssets) ||
      asNumber(summary?.institution?.totalAssets) ||
      asNumber(institution?.totalAssets);
    const exactLiabilitiesRaw =
      totalLiabilitiesFromItems ||
      asNumber(compliance?.summary?.totalLiabilities) ||
      0;
    const exactEquityRaw =
      asNumber(compliance?.summary?.equity) ||
      (exactAssetsRaw && exactLiabilitiesRaw
        ? exactAssetsRaw - exactLiabilitiesRaw
        : 0);

    const capitalRatio =
      asNumber(compliance?.summary?.capitalRatio) ||
      (exactAssetsRaw > 0 ? (exactEquityRaw / exactAssetsRaw) * 100 : 0);
    const lcr = asNumber(summary?.liquidity?.lcr);
    const durationGap = asNumber(summary?.durationGap?.durationGap);
    const baseNII = asNumber(summary?.niiSensitivity?.baseNII);
    const riskScore = asNumber(summary?.riskScore);

    const scoreTone =
      riskScore >= 80
        ? 'success'
        : riskScore >= 60
          ? 'info'
          : riskScore >= 40
            ? 'warning'
            : 'danger';
    const scoreLabel =
      riskScore >= 80
        ? this.tx(lang, 'Stable risk posture', 'Postura de riesgo estable')
        : riskScore >= 60
          ? this.tx(lang, 'Watch list posture', 'Postura bajo vigilancia')
          : riskScore >= 40
            ? this.tx(
                lang,
                'Elevated risk posture',
                'Postura de riesgo elevada',
              )
            : this.tx(
                lang,
                'Immediate attention needed',
                'Atención inmediata requerida',
              );

    const assetsMetric = formatter.moneyWithCompact(exactAssetsRaw);
    const institutionTypeLabel = this.humanizeInstitutionType(
      institution?.type,
    );
    const primaryRegulator = institution?.primaryRegulator || 'COSSEC';

    const overviewMetrics: ReportMetric[] = [
      {
        label: this.tx(lang, 'Total assets', 'Activos totales'),
        value: assetsMetric.exact,
        helper: assetsMetric.compact ? `(${assetsMetric.compact})` : null,
        tone: 'info',
      },
      {
        label: this.tx(lang, 'Capital ratio', 'Razón de capital'),
        value: formatter.percent(capitalRatio, 2),
        helper: this.tx(
          lang,
          `Equity ${formatter.money(exactEquityRaw)}`,
          `Capital ${formatter.money(exactEquityRaw)}`,
        ),
        tone:
          capitalRatio >= 10
            ? 'success'
            : capitalRatio >= 8
              ? 'warning'
              : 'danger',
      },
      {
        label: 'LCR',
        value: lcr ? formatter.percent(lcr, 1) : this.unavailable(lang),
        helper: summary?.liquidity
          ? this.tx(
              lang,
              `${formatter.money(summary.liquidity.hqla)} HQLA vs ${formatter.money(summary.liquidity.netOutflows)} outflows`,
              `${formatter.money(summary.liquidity.hqla)} HQLA frente a ${formatter.money(summary.liquidity.netOutflows)} salidas`,
            )
          : null,
        tone: toneFromStatus(summary?.liquidity?.status),
      },
      {
        label: this.tx(lang, 'Duration gap', 'Brecha de duración'),
        value: durationGap
          ? `${durationGap >= 0 ? '+' : ''}${formatter.years(durationGap, 2)}`
          : this.unavailable(lang),
        helper: summary?.durationGap?.riskProfile
          ? this.humanizeRiskProfile(summary.durationGap.riskProfile, lang)
          : null,
        tone:
          Math.abs(durationGap) >= 2
            ? 'warning'
            : Math.abs(durationGap) >= 1
              ? 'info'
              : 'success',
      },
      {
        label: this.tx(lang, 'Base NII', 'NII base'),
        value: baseNII ? formatter.money(baseNII) : this.unavailable(lang),
        helper: summary?.niiSensitivity?.riskRating
          ? this.tx(
              lang,
              `Risk rating: ${String(summary.niiSensitivity.riskRating).toUpperCase()}`,
              `Calificación de riesgo: ${String(summary.niiSensitivity.riskRating).toUpperCase()}`,
            )
          : null,
        tone: toneFromStatus(summary?.niiSensitivity?.riskRating),
      },
      {
        label: this.tx(lang, 'Regulator', 'Regulador'),
        value: primaryRegulator,
        helper: institutionTypeLabel,
        tone: 'neutral',
      },
    ];

    const executiveHeadline = this.tx(
      lang,
      `${institution?.name || 'Institution'} enters the board cycle with ${scoreLabel.toLowerCase()}, ${formatter.percent(capitalRatio, 2)} capital, and ${lcr ? formatter.percent(lcr, 1) : this.unavailable(lang)} liquidity coverage.`,
      `${institution?.name || 'Institución'} entra al ciclo de junta con ${scoreLabel.toLowerCase()}, capital de ${formatter.percent(capitalRatio, 2)} y cobertura de liquidez de ${lcr ? formatter.percent(lcr, 1) : this.unavailable(lang)}.`,
    );

    const executiveNarrative = this.buildExecutiveNarrative({
      lang,
      formatter,
      institutionName: institution?.name || 'Institution',
      riskScore,
      capitalRatio,
      lcr,
      durationGap,
      baseNII,
      regulator: primaryRegulator,
    });

    const keyRisks = this.deriveTopRisks({
      lang,
      formatter,
      summary,
      compliance,
      capitalRatio,
      lcr,
      durationGap,
    });

    const recommendations = this.deriveRecommendations({
      lang,
      summary,
      capitalRatio,
      lcr,
      durationGap,
      primaryRegulator,
    });

    const availabilityNotes = [
      summary
        ? null
        : this.buildUnavailableNote(lang, 'ALM summary', input.summaryError),
      stress
        ? null
        : this.buildUnavailableNote(lang, 'stress testing', input.stressError),
      compliance
        ? null
        : this.buildUnavailableNote(
            lang,
            'regulatory compliance',
            input.complianceError,
          ),
    ].filter(Boolean) as string[];

    const balanceSheet = this.buildBalanceSheetSection({
      lang,
      formatter,
      institution,
      totalAssetsRaw: exactAssetsRaw,
      totalLiabilitiesRaw: exactLiabilitiesRaw,
      equityRaw: exactEquityRaw,
      capitalRatio,
    });

    const interestRate = this.buildInterestRateSection({
      lang,
      formatter,
      summary,
      durationGap,
      baseNII,
    });

    const liquidityStress = this.buildLiquidityStressSection({
      lang,
      formatter,
      summary,
      stress,
    });

    const regulatory = this.buildRegulatorySection({
      lang,
      formatter,
      compliance,
      capitalRatio,
      primaryRegulator,
    });

    return {
      lang,
      formatter,
      institutionName: institution?.name || 'Institution',
      institutionTypeLabel,
      currency: institution?.currency || 'USD',
      primaryRegulator,
      reportId: `RPT-${Date.now().toString(36).toUpperCase()}-${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`,
      generatedAtLabel: formatter.date(new Date()),
      reportingPeriodLabel: formatter.month(
        institution?.reportingDate || summary?.institution?.reportingDate,
      ),
      assetsMetric,
      executiveHeadline,
      executiveNarrative,
      overviewMetrics,
      keyRisks,
      recommendations,
      availabilityNotes,
      balanceSheet,
      interestRate,
      liquidityStress,
      regulatory,
    };
  }

  private buildBalanceSheetSection(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    institution: any;
    totalAssetsRaw: number;
    totalLiabilitiesRaw: number;
    equityRaw: number;
    capitalRatio: number;
  }): SectionState<BalanceSheetSection> {
    const {
      lang,
      formatter,
      institution,
      totalAssetsRaw,
      totalLiabilitiesRaw,
      equityRaw,
      capitalRatio,
    } = input;
    const items = Array.isArray(institution?.balanceSheetItems)
      ? institution.balanceSheetItems
      : [];
    const assetItems = items.filter((item: any) => item.category === 'asset');
    const liabilityItems = items.filter(
      (item: any) => item.category === 'liability',
    );

    const available = assetItems.length > 0 || liabilityItems.length > 0;
    if (!available) {
      return {
        available: false,
        note: this.tx(
          lang,
          'Balance-sheet items are not available yet. The report is showing institution-level totals only.',
          'Los rubros del balance aún no están disponibles. El informe muestra solamente los totales institucionales.',
        ),
        data: {
          summaryRows: [
            {
              cells: [
                this.tx(lang, 'Total assets', 'Activos totales'),
                formatter.money(totalAssetsRaw),
              ],
            },
            {
              cells: [
                this.tx(lang, 'Total liabilities', 'Pasivos totales'),
                formatter.money(totalLiabilitiesRaw),
              ],
            },
            {
              cells: [
                this.tx(lang, 'Equity', 'Capital'),
                formatter.money(equityRaw),
              ],
              tone: 'info',
            },
            {
              cells: [
                this.tx(lang, 'Capital ratio', 'Razón de capital'),
                formatter.percent(capitalRatio, 2),
              ],
              tone: capitalRatio >= 8 ? 'success' : 'danger',
            },
          ],
          assetRows: [],
          liabilityRows: [],
        },
      };
    }

    return {
      available: true,
      note: null,
      data: {
        summaryRows: [
          {
            cells: [
              this.tx(lang, 'Total assets', 'Activos totales'),
              formatter.money(totalAssetsRaw),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Total liabilities', 'Pasivos totales'),
              formatter.money(totalLiabilitiesRaw),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Equity', 'Capital'),
              formatter.money(equityRaw),
            ],
            tone: 'info',
          },
          {
            cells: [
              this.tx(lang, 'Capital ratio', 'Razón de capital'),
              formatter.percent(capitalRatio, 2),
            ],
            tone: capitalRatio >= 8 ? 'success' : 'danger',
          },
        ],
        assetRows: assetItems.map((item: any) => ({
          cells: [
            item.name || this.tx(lang, 'Unnamed asset', 'Activo sin nombre'),
            formatter.money(item.balance),
            formatter.percent(item.rate, 2),
            formatter.years(item.duration, 2),
            String(item.rateType || '').toUpperCase() || 'N/A',
          ],
        })),
        liabilityRows: liabilityItems.map((item: any) => ({
          cells: [
            item.name ||
              this.tx(lang, 'Unnamed liability', 'Pasivo sin nombre'),
            formatter.money(item.balance),
            formatter.percent(item.rate, 2),
            formatter.years(item.duration, 2),
            String(item.rateType || '').toUpperCase() || 'N/A',
          ],
        })),
      },
    };
  }

  private buildInterestRateSection(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    summary: ALMSummaryResult | null;
    durationGap: number;
    baseNII: number;
  }): SectionState<InterestRateSection> {
    const { lang, formatter, summary, durationGap, baseNII } = input;

    if (!summary) {
      return {
        available: false,
        note: this.tx(
          lang,
          'Interest-rate analytics are unavailable because the ALM summary could not be computed.',
          'Los analíticos de tasa no están disponibles porque no se pudo calcular el resumen ALM.',
        ),
        data: null,
      };
    }

    const scenarios = Array.isArray(summary.niiSensitivity?.scenarios)
      ? [...summary.niiSensitivity.scenarios].sort(
          (left, right) => asNumber(left.shiftBps) - asNumber(right.shiftBps),
        )
      : [];

    return {
      available: true,
      note: null,
      data: {
        narrative: this.tx(
          lang,
          `${summary.institution.name} is ${this.humanizeRiskProfile(summary.durationGap.riskProfile, lang)} with an asset duration of ${formatter.years(summary.durationGap.assetDuration, 2)} against liability duration of ${formatter.years(summary.durationGap.liabilityDuration, 2)}. Base NII stands at ${formatter.money(baseNII)} and the modeled rate risk points to a ${durationGap >= 0 ? 'positive' : 'negative'} duration gap of ${formatter.years(durationGap, 2)}.`,
          `${summary.institution.name} presenta ${this.humanizeRiskProfile(summary.durationGap.riskProfile, lang)} con duración de activos de ${formatter.years(summary.durationGap.assetDuration, 2)} frente a duración de pasivos de ${formatter.years(summary.durationGap.liabilityDuration, 2)}. El NII base se ubica en ${formatter.money(baseNII)} y el riesgo modelado señala una brecha de duración ${durationGap >= 0 ? 'positiva' : 'negativa'} de ${formatter.years(durationGap, 2)}.`,
        ),
        metricRows: [
          {
            cells: [
              this.tx(lang, 'Asset duration', 'Duración de activos'),
              formatter.years(summary.durationGap.assetDuration, 2),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Liability duration', 'Duración de pasivos'),
              formatter.years(summary.durationGap.liabilityDuration, 2),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Duration gap', 'Brecha de duración'),
              `${durationGap >= 0 ? '+' : ''}${formatter.years(durationGap, 2)}`,
            ],
            tone: Math.abs(durationGap) >= 2 ? 'warning' : 'success',
          },
          {
            cells: [
              this.tx(lang, 'Base NII', 'NII base'),
              formatter.money(baseNII),
            ],
          },
        ],
        scenarioRows: scenarios.map((scenario: any) => ({
          cells: [
            scenario.name || `${scenario.shiftBps} bps`,
            `${asNumber(scenario.shiftBps) >= 0 ? '+' : ''}${asNumber(
              scenario.shiftBps,
            )} bps`,
            formatter.signedMoney(scenario.niImpact),
            formatter.percent(scenario.niImpactPct, 2, true),
            formatter.signedMoney(scenario.mveImpact),
            formatter.percent(scenario.mveImpactPct, 2, true),
          ],
          tone:
            asNumber(scenario.niImpact) < 0 || asNumber(scenario.mveImpact) < 0
              ? 'warning'
              : 'success',
        })),
      },
    };
  }

  private buildLiquidityStressSection(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    summary: ALMSummaryResult | null;
    stress: StressTestResult | null;
  }): SectionState<LiquidityStressSection> {
    const { lang, formatter, summary, stress } = input;

    const available = Boolean(summary || stress);
    if (!available) {
      return {
        available: false,
        note: this.tx(
          lang,
          'Liquidity and stress testing data are unavailable for this institution.',
          'Los datos de liquidez y pruebas de estrés no están disponibles para esta institución.',
        ),
        data: null,
      };
    }

    const lcr = asNumber(summary?.liquidity?.lcr);
    const liquidityNarrative = summary
      ? this.tx(
          lang,
          `Liquidity coverage currently stands at ${formatter.percent(lcr, 1)} with ${formatter.money(summary.liquidity.hqla)} of HQLA backing ${formatter.money(summary.liquidity.netOutflows)} of modeled 30-day net outflows.`,
          `La cobertura de liquidez se ubica actualmente en ${formatter.percent(lcr, 1)} con ${formatter.money(summary.liquidity.hqla)} de HQLA respaldando ${formatter.money(summary.liquidity.netOutflows)} de salidas netas modeladas a 30 días.`,
        )
      : this.tx(
          lang,
          'Liquidity metrics are unavailable, but stress outputs are included below.',
          'Las métricas de liquidez no están disponibles, pero se incluyen los resultados de estrés a continuación.',
        );

    const hqla = asNumber(summary?.liquidity?.hqla);
    const hqlaRows: ReportTableRow[] = hqla
      ? [
          {
            cells: [
              this.tx(lang, 'Level 1 liquidity', 'Liquidez nivel 1'),
              formatter.money(hqla * 0.7),
              '70%',
            ],
          },
          {
            cells: [
              this.tx(lang, 'Level 2 liquidity', 'Liquidez nivel 2'),
              formatter.money(hqla * 0.3),
              '30%',
            ],
          },
          {
            cells: [
              this.tx(lang, 'Total HQLA', 'HQLA total'),
              formatter.money(hqla),
              '100%',
            ],
            tone: 'info',
          },
        ]
      : [];

    const stressOverviewRows: ReportTableRow[] = stress?.monteCarlo
      ? [
          {
            cells: [
              this.tx(lang, 'Expected NII', 'NII esperado'),
              formatter.money(stress.monteCarlo.expectedNII),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Worst case NII', 'NII peor caso'),
              formatter.money(stress.monteCarlo.worstCaseNII),
            ],
            tone: 'danger',
          },
          {
            cells: [
              this.tx(lang, 'NII at risk', 'NII en riesgo'),
              formatter.money(stress.monteCarlo.niiAtRisk),
            ],
            tone: 'warning',
          },
          {
            cells: [
              this.tx(lang, 'Simulation paths', 'Trayectorias simuladas'),
              formatter.integer(stress.monteCarlo.paths),
            ],
          },
        ]
      : [];

    const regulatoryStressRows: ReportTableRow[] = Array.isArray(
      stress?.regulatory?.scenarios,
    )
      ? stress.regulatory.scenarios.map((scenario: any) => ({
          cells: [
            scenario.name || 'Scenario',
            formatter.signedMoney(scenario.niImpact),
            formatter.signedMoney(scenario.mveImpact),
            formatter.percent(scenario.lcrImpact, 1, true),
            formatter.percent(scenario.capitalImpact, 2, true),
            String(scenario.passFailStatus || '').toUpperCase() || 'N/A',
          ],
          tone: toneFromStatus(scenario.passFailStatus),
        }))
      : [];

    return {
      available: true,
      note: null,
      data: {
        liquidityNarrative,
        liquidityRows: summary
          ? [
              {
                cells: ['LCR', formatter.percent(summary.liquidity.lcr, 1)],
                tone: toneFromStatus(summary.liquidity.status),
              },
              {
                cells: [
                  this.tx(lang, 'HQLA', 'HQLA'),
                  formatter.money(summary.liquidity.hqla),
                ],
              },
              {
                cells: [
                  this.tx(lang, 'Net outflows', 'Salidas netas'),
                  formatter.money(summary.liquidity.netOutflows),
                ],
              },
              {
                cells: [
                  this.tx(lang, 'Buffer vs 100%', 'Colchón sobre 100%'),
                  formatter.percent(summary.liquidity.buffer, 1, true),
                ],
                tone:
                  asNumber(summary.liquidity.buffer) >= 0
                    ? 'success'
                    : 'danger',
              },
            ]
          : [],
        hqlaRows,
        stressOverviewRows,
        regulatoryStressRows,
      },
    };
  }

  private buildRegulatorySection(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    compliance: COSSECComplianceResult | null;
    capitalRatio: number;
    primaryRegulator: string;
  }): SectionState<RegulatorySection> {
    const { lang, formatter, compliance, capitalRatio, primaryRegulator } =
      input;

    if (!compliance) {
      return {
        available: false,
        note: this.tx(
          lang,
          `Regulatory compliance output for ${primaryRegulator} is unavailable. The report still includes board-level capital and liquidity figures.`,
          `La salida regulatoria para ${primaryRegulator} no está disponible. El informe aún incluye cifras de capital y liquidez a nivel de junta.`,
        ),
        data: {
          statusLabel: this.unavailable(lang),
          statusTone: capitalRatio >= 8 ? 'warning' : 'danger',
          summaryRows: [
            {
              cells: [
                this.tx(lang, 'Capital ratio', 'Razón de capital'),
                formatter.percent(capitalRatio, 2),
              ],
            },
          ],
          checkRows: [],
          notes: [],
        },
      };
    }

    const statusTone = toneFromStatus(compliance.overallStatus);
    const statusLabel = this.tx(
      lang,
      `${primaryRegulator} status: ${String(compliance.overallStatus || '').toUpperCase()}`,
      `Estado ${primaryRegulator}: ${String(compliance.overallStatus || '').toUpperCase()}`,
    );

    return {
      available: true,
      note: null,
      data: {
        statusLabel,
        statusTone,
        summaryRows: [
          {
            cells: [
              this.tx(lang, 'Exam readiness', 'Preparación para examen'),
              formatter.percent(compliance.examReadinessScore, 0),
            ],
            tone: compliance.examReadinessScore >= 80 ? 'success' : 'warning',
          },
          {
            cells: [
              this.tx(lang, 'Total assets', 'Activos totales'),
              formatter.money(compliance.summary?.totalAssets),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Total loans', 'Préstamos totales'),
              formatter.money(compliance.summary?.totalLoans),
            ],
          },
          {
            cells: [
              this.tx(lang, 'Liquid assets', 'Activos líquidos'),
              formatter.money(compliance.summary?.liquidAssets),
            ],
          },
        ],
        checkRows: Array.isArray(compliance.checks)
          ? compliance.checks.map((check: any) => ({
              cells: [
                lang === 'es' && check.nameEs
                  ? check.nameEs
                  : check.name || 'Metric',
                formatter.percent(check.value, 2),
                `${check.threshold}${check.unit || ''}`,
                String(check.status || '').toUpperCase() || 'N/A',
              ],
              tone: toneFromStatus(check.status),
            }))
          : [],
        notes: Array.isArray(compliance.checks)
          ? compliance.checks
              .map((check: any) =>
                lang === 'es' && check.descriptionEs
                  ? check.descriptionEs
                  : check.description,
              )
              .filter(Boolean)
          : [],
      },
    };
  }

  private deriveTopRisks(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    summary: ALMSummaryResult | null;
    compliance: COSSECComplianceResult | null;
    capitalRatio: number;
    lcr: number;
    durationGap: number;
  }): string[] {
    const {
      lang,
      formatter,
      summary,
      compliance,
      capitalRatio,
      lcr,
      durationGap,
    } = input;
    const risks = [
      ...(Array.isArray(summary?.topRisks) ? summary.topRisks : []),
    ];

    if (Math.abs(durationGap) >= 2) {
      risks.push(
        this.tx(
          lang,
          `Duration gap of ${formatter.years(durationGap, 2)} is outside a comfortable board range and should be repriced or hedged.`,
          `La brecha de duración de ${formatter.years(durationGap, 2)} está fuera de un rango cómodo para la junta y debe repricingarse o cubrirse.`,
        ),
      );
    }

    if (lcr > 0 && lcr < 100) {
      risks.push(
        this.tx(
          lang,
          `Liquidity coverage at ${formatter.percent(lcr, 1)} is below the 100% reference threshold.`,
          `La cobertura de liquidez de ${formatter.percent(lcr, 1)} está por debajo del umbral de referencia de 100%.`,
        ),
      );
    }

    if (capitalRatio > 0 && capitalRatio < 8) {
      risks.push(
        this.tx(
          lang,
          `Capital ratio of ${formatter.percent(capitalRatio, 2)} is thin for the current risk profile.`,
          `La razón de capital de ${formatter.percent(capitalRatio, 2)} es estrecha para el perfil de riesgo actual.`,
        ),
      );
    }

    if (
      compliance?.overallStatus &&
      String(compliance.overallStatus).toLowerCase() !== 'compliant'
    ) {
      risks.push(
        this.tx(
          lang,
          `${compliance.institutionName || 'Institution'} is not fully compliant under the latest ${compliance.institutionType || ''} regulatory profile.`,
          `${compliance.institutionName || 'La institución'} no está totalmente cumplidora bajo el perfil regulatorio más reciente de ${compliance.institutionType || ''}.`,
        ),
      );
    }

    return risks.slice(0, 5);
  }

  private deriveRecommendations(input: {
    lang: ReportLanguage;
    summary: ALMSummaryResult | null;
    capitalRatio: number;
    lcr: number;
    durationGap: number;
    primaryRegulator: string;
  }): ReportRecommendation[] {
    const { lang, summary, capitalRatio, lcr, durationGap, primaryRegulator } =
      input;

    const sourceRecs = Array.isArray(summary?.recommendations)
      ? summary.recommendations
      : [];
    const derived: ReportRecommendation[] = sourceRecs.map((text, index) => ({
      priority: index < 2 ? 'HIGH' : index < 4 ? 'MEDIUM' : 'LOW',
      text,
    }));

    if (Math.abs(durationGap) >= 2) {
      derived.push({
        priority: 'HIGH',
        text: this.tx(
          lang,
          'Reduce the duration mismatch by extending liability tenor, shortening asset duration, or layering a hedge before the next board cycle.',
          'Reduzca el descalce de duración extendiendo el plazo de pasivos, acortando la duración de activos o incorporando cobertura antes del próximo ciclo de junta.',
        ),
      });
    }

    if (lcr > 0 && lcr < 110) {
      derived.push({
        priority: 'HIGH',
        text: this.tx(
          lang,
          'Raise on-balance-sheet liquidity so the institution operates with a durable LCR cushion rather than at-threshold coverage.',
          'Eleve la liquidez en balance para que la institución opere con un colchón de LCR durable en vez de una cobertura al límite.',
        ),
      });
    }

    if (capitalRatio > 0 && capitalRatio < 9) {
      derived.push({
        priority: 'MEDIUM',
        text: this.tx(
          lang,
          `Review capital planning against ${primaryRegulator} expectations and preserve retained earnings until the ratio rebuilds.`,
          `Revise la planificación de capital contra las expectativas de ${primaryRegulator} y preserve utilidades retenidas hasta recomponer la razón.`,
        ),
      });
    }

    if (derived.length === 0) {
      derived.push({
        priority: 'MEDIUM',
        text: this.tx(
          lang,
          'Continue board-level monitoring of rate sensitivity, liquidity, and capital to preserve the current posture.',
          'Mantenga el monitoreo a nivel de junta sobre sensibilidad a tasas, liquidez y capital para preservar la postura actual.',
        ),
      });
    }

    return derived.slice(0, 6);
  }

  private buildExecutiveNarrative(input: {
    lang: ReportLanguage;
    formatter: ReturnType<typeof createReportFormatter>;
    institutionName: string;
    riskScore: number;
    capitalRatio: number;
    lcr: number;
    durationGap: number;
    baseNII: number;
    regulator: string;
  }): string {
    const {
      lang,
      formatter,
      institutionName,
      riskScore,
      capitalRatio,
      lcr,
      durationGap,
      baseNII,
      regulator,
    } = input;
    return this.tx(
      lang,
      `${institutionName} is entering this reporting period with a risk score of ${formatter.integer(riskScore)}/100, capital at ${formatter.percent(capitalRatio, 2)}, and base net interest income of ${formatter.money(baseNII)}. Liquidity coverage is ${lcr ? formatter.percent(lcr, 1) : 'not available'} and the modeled duration gap is ${durationGap >= 0 ? 'positive' : 'negative'} at ${formatter.years(durationGap, 2)}. Board discussion should focus on whether the current balance-sheet posture remains acceptable under ${regulator} expectations.`,
      `${institutionName} entra a este período con una puntuación de riesgo de ${formatter.integer(riskScore)}/100, capital de ${formatter.percent(capitalRatio, 2)} y un ingreso neto por intereses base de ${formatter.money(baseNII)}. La cobertura de liquidez es ${lcr ? formatter.percent(lcr, 1) : 'no disponible'} y la brecha de duración modelada es ${durationGap >= 0 ? 'positiva' : 'negativa'} en ${formatter.years(durationGap, 2)}. La conversación de junta debe enfocarse en si la postura actual del balance sigue siendo aceptable bajo las expectativas de ${regulator}.`,
    );
  }

  private renderCoverPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.rect(0, 0, doc.page.width, 128).fill(REPORT_THEME.dark);
    doc.rect(0, 0, doc.page.width, 6).fill(REPORT_THEME.brand);
    this.drawWatermark(doc, watermark);

    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('CERNIQ', left, 24);
    doc
      .fillColor('#cbd5e1')
      .font('Helvetica')
      .fontSize(9)
      .text(
        payload.lang === 'es'
          ? 'Informe premium para junta'
          : 'Board-ready premium report',
        left,
        42,
      );

    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(payload.institutionName, left, 152, { width });
    doc
      .fillColor(REPORT_THEME.brandAlt)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(
        payload.lang === 'es'
          ? 'Informe de gestión de activos y pasivos'
          : 'Asset liability management report',
        left,
        190,
        { width },
      );

    const metaRows = [
      [
        this.tx(payload.lang, 'Institution type', 'Tipo de institución'),
        payload.institutionTypeLabel,
      ],
      [
        this.tx(payload.lang, 'Regulator', 'Regulador'),
        payload.primaryRegulator,
      ],
      [
        this.tx(payload.lang, 'Reporting period', 'Período reportado'),
        payload.reportingPeriodLabel,
      ],
      [
        this.tx(payload.lang, 'Generated on', 'Generado el'),
        payload.generatedAtLabel,
      ],
      [this.tx(payload.lang, 'Report ID', 'ID del informe'), payload.reportId],
    ];
    let metaY = 232;
    for (const [label, value] of metaRows) {
      doc
        .fillColor(REPORT_THEME.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(label, left, metaY, { width: 120 });
      doc
        .fillColor(REPORT_THEME.heading)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(value, left + 128, metaY, { width: width - 128 });
      metaY += 18;
    }

    this.drawTonePanel(
      doc,
      left,
      350,
      width,
      72,
      scoreTone(payload.overviewMetrics),
      '',
    );
    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(payload.executiveHeadline, left + 18, 366, {
        width: width - 36,
      });
    doc
      .fillColor(REPORT_THEME.body)
      .font('Helvetica')
      .fontSize(10)
      .text(payload.executiveNarrative, left + 18, 394, {
        width: width - 36,
      });

    this.drawMetricCards(
      doc,
      payload,
      446,
      payload.overviewMetrics.slice(0, 4),
    );

    if (payload.availabilityNotes.length > 0) {
      this.drawPanel(
        doc,
        left,
        596,
        width,
        96,
        REPORT_THEME.warningBg,
        REPORT_THEME.warning,
      );
      doc
        .fillColor(REPORT_THEME.warning)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(
          this.tx(
            payload.lang,
            'Data availability notes',
            'Notas de disponibilidad de datos',
          ),
          left + 14,
          608,
        );
      doc
        .fillColor(REPORT_THEME.body)
        .font('Helvetica')
        .fontSize(8.5)
        .text(payload.availabilityNotes.join(' '), left + 14, 626, {
          width: width - 28,
        });
    }

    this.drawFooter(doc, payload, 1);
  }

  private renderOverviewPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(payload.lang, 'Board highlights', 'Hallazgos para junta'),
      this.tx(
        payload.lang,
        'Institution-specific headline metrics and risk framing',
        'Métricas institucionales y marco de riesgos',
      ),
      2,
    );

    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(
        this.tx(payload.lang, 'Headline metrics', 'Métricas clave'),
        doc.page.margins.left,
        doc.y,
      );
    doc.moveDown(0.4);
    const metricGridHeight = this.drawMetricCards(
      doc,
      payload,
      doc.y,
      payload.overviewMetrics,
    );
    doc.y += metricGridHeight + 14;

    this.drawPanel(
      doc,
      doc.page.margins.left,
      doc.y,
      doc.page.width - doc.page.margins.left - doc.page.margins.right,
      106,
      REPORT_THEME.panel,
      REPORT_THEME.brandAlt,
    );
    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(
        this.tx(payload.lang, 'Board narrative', 'Narrativa para junta'),
        doc.page.margins.left + 14,
        doc.y + 12,
      );
    doc
      .fillColor(REPORT_THEME.body)
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        payload.executiveNarrative,
        doc.page.margins.left + 14,
        doc.y + 30,
        {
          width:
            doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right -
            28,
        },
      );
    doc.y += 124;

    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(
        this.tx(
          payload.lang,
          'Top risks for discussion',
          'Riesgos principales para discusión',
        ),
        doc.page.margins.left,
        doc.y,
      );
    doc.moveDown(0.5);
    payload.keyRisks.forEach((risk) => {
      this.ensureSpace(doc, 28, payload, 2);
      doc
        .fillColor(REPORT_THEME.danger)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('•', doc.page.margins.left, doc.y + 1);
      doc
        .fillColor(REPORT_THEME.body)
        .font('Helvetica')
        .fontSize(9.5)
        .text(risk, doc.page.margins.left + 14, doc.y, {
          width:
            doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right -
            18,
        });
      doc.moveDown(0.9);
    });

    this.drawFooter(doc, payload, 2);
  }

  private renderBalanceSheetPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(
        payload.lang,
        'Balance-sheet snapshot',
        'Estado de situación financiera',
      ),
      this.tx(
        payload.lang,
        'Exact balance and pricing context',
        'Contexto exacto de balance y precios',
      ),
      3,
    );

    if (!payload.balanceSheet.available && payload.balanceSheet.note) {
      this.drawUnavailablePanel(doc, payload.balanceSheet.note, payload);
    }

    const summaryData = payload.balanceSheet.data;
    if (summaryData) {
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Metric', 'Métrica'),
          this.tx(payload.lang, 'Value', 'Valor'),
        ],
        summaryData.summaryRows,
        [0.55, 0.45],
        3,
      );
      doc.moveDown(0.6);

      if (summaryData.assetRows.length > 0) {
        this.drawSectionLabel(
          doc,
          payload,
          this.tx(payload.lang, 'Assets', 'Activos'),
        );
        this.drawTable(
          doc,
          payload,
          [
            this.tx(payload.lang, 'Name', 'Nombre'),
            this.tx(payload.lang, 'Balance', 'Saldo'),
            this.tx(payload.lang, 'Rate', 'Tasa'),
            this.tx(payload.lang, 'Duration', 'Duración'),
            this.tx(payload.lang, 'Type', 'Tipo'),
          ],
          summaryData.assetRows,
          [0.34, 0.21, 0.15, 0.15, 0.15],
          3,
        );
        doc.moveDown(0.6);
      }

      if (summaryData.liabilityRows.length > 0) {
        this.drawSectionLabel(
          doc,
          payload,
          this.tx(payload.lang, 'Liabilities', 'Pasivos'),
        );
        this.drawTable(
          doc,
          payload,
          [
            this.tx(payload.lang, 'Name', 'Nombre'),
            this.tx(payload.lang, 'Balance', 'Saldo'),
            this.tx(payload.lang, 'Rate', 'Tasa'),
            this.tx(payload.lang, 'Duration', 'Duración'),
            this.tx(payload.lang, 'Type', 'Tipo'),
          ],
          summaryData.liabilityRows,
          [0.34, 0.21, 0.15, 0.15, 0.15],
          3,
        );
      }
    }

    this.drawFooter(doc, payload, 3);
  }

  private renderInterestRatePage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(payload.lang, 'Interest-rate risk', 'Riesgo de tasa'),
      this.tx(
        payload.lang,
        'Duration posture and NII sensitivity',
        'Postura de duración y sensibilidad NII',
      ),
      4,
    );

    if (!payload.interestRate.available) {
      this.drawUnavailablePanel(
        doc,
        payload.interestRate.note || this.unavailable(payload.lang),
        payload,
      );
      this.drawFooter(doc, payload, 4);
      return;
    }

    const interestData = payload.interestRate.data!;
    this.drawPanel(
      doc,
      doc.page.margins.left,
      doc.y,
      doc.page.width - doc.page.margins.left - doc.page.margins.right,
      88,
      REPORT_THEME.panel,
      REPORT_THEME.brandAlt,
    );
    doc
      .fillColor(REPORT_THEME.body)
      .font('Helvetica')
      .fontSize(9.5)
      .text(interestData.narrative, doc.page.margins.left + 14, doc.y + 14, {
        width:
          doc.page.width - doc.page.margins.left - doc.page.margins.right - 28,
      });
    doc.y += 102;

    this.drawTable(
      doc,
      payload,
      [
        this.tx(payload.lang, 'Metric', 'Métrica'),
        this.tx(payload.lang, 'Value', 'Valor'),
      ],
      interestData.metricRows,
      [0.52, 0.48],
      4,
    );
    doc.moveDown(0.8);

    if (interestData.scenarioRows.length > 0) {
      this.drawSectionLabel(
        doc,
        payload,
        this.tx(
          payload.lang,
          'Modeled rate shocks',
          'Choques de tasa modelados',
        ),
      );
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Scenario', 'Escenario'),
          this.tx(payload.lang, 'Shift', 'Cambio'),
          'NII',
          'NII %',
          'MVE',
          'MVE %',
        ],
        interestData.scenarioRows,
        [0.25, 0.12, 0.18, 0.15, 0.16, 0.14],
        4,
      );
    }

    this.drawFooter(doc, payload, 4);
  }

  private renderLiquidityStressPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(payload.lang, 'Liquidity and stress', 'Liquidez y estrés'),
      this.tx(
        payload.lang,
        'Liquidity buffer plus scenario resilience',
        'Colchón de liquidez y resiliencia por escenarios',
      ),
      5,
    );

    if (!payload.liquidityStress.available) {
      this.drawUnavailablePanel(
        doc,
        payload.liquidityStress.note || this.unavailable(payload.lang),
        payload,
      );
      this.drawFooter(doc, payload, 5);
      return;
    }

    const liquidityData = payload.liquidityStress.data!;
    this.drawPanel(
      doc,
      doc.page.margins.left,
      doc.y,
      doc.page.width - doc.page.margins.left - doc.page.margins.right,
      72,
      REPORT_THEME.infoBg,
      REPORT_THEME.info,
    );
    doc
      .fillColor(REPORT_THEME.body)
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        liquidityData.liquidityNarrative,
        doc.page.margins.left + 14,
        doc.y + 14,
        {
          width:
            doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right -
            28,
        },
      );
    doc.y += 84;

    if (liquidityData.liquidityRows.length > 0) {
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Liquidity metric', 'Métrica de liquidez'),
          this.tx(payload.lang, 'Value', 'Valor'),
        ],
        liquidityData.liquidityRows,
        [0.56, 0.44],
        5,
      );
      doc.moveDown(0.8);
    }

    if (liquidityData.hqlaRows.length > 0) {
      this.drawSectionLabel(
        doc,
        payload,
        this.tx(
          payload.lang,
          'Indicative HQLA mix',
          'Mezcla indicativa de HQLA',
        ),
      );
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Category', 'Categoría'),
          this.tx(payload.lang, 'Amount', 'Monto'),
          this.tx(payload.lang, 'Share', 'Participación'),
        ],
        liquidityData.hqlaRows,
        [0.45, 0.33, 0.22],
        5,
      );
      doc.moveDown(0.8);
    }

    if (liquidityData.stressOverviewRows.length > 0) {
      this.drawSectionLabel(
        doc,
        payload,
        this.tx(payload.lang, 'Monte Carlo summary', 'Resumen Monte Carlo'),
      );
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Stress metric', 'Métrica de estrés'),
          this.tx(payload.lang, 'Value', 'Valor'),
        ],
        liquidityData.stressOverviewRows,
        [0.56, 0.44],
        5,
      );
      doc.moveDown(0.8);
    }

    if (liquidityData.regulatoryStressRows.length > 0) {
      this.drawSectionLabel(
        doc,
        payload,
        this.tx(
          payload.lang,
          'Regulatory scenarios',
          'Escenarios regulatorios',
        ),
      );
      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Scenario', 'Escenario'),
          'NII',
          'MVE',
          'LCR',
          this.tx(payload.lang, 'Capital', 'Capital'),
          this.tx(payload.lang, 'Status', 'Estado'),
        ],
        liquidityData.regulatoryStressRows,
        [0.24, 0.16, 0.16, 0.14, 0.14, 0.16],
        5,
      );
    }

    this.drawFooter(doc, payload, 5);
  }

  private renderRegulatoryPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(payload.lang, 'Regulatory posture', 'Postura regulatoria'),
      this.tx(
        payload.lang,
        'Current regulator-facing indicators',
        'Indicadores actuales frente al regulador',
      ),
      6,
    );

    if (!payload.regulatory.available && payload.regulatory.note) {
      this.drawUnavailablePanel(doc, payload.regulatory.note, payload);
    }

    const regulatoryData = payload.regulatory.data;
    if (regulatoryData) {
      this.drawTonePanel(
        doc,
        doc.page.margins.left,
        doc.y,
        doc.page.width - doc.page.margins.left - doc.page.margins.right,
        52,
        regulatoryData.statusTone,
        regulatoryData.statusLabel,
      );
      doc.y += 64;

      this.drawTable(
        doc,
        payload,
        [
          this.tx(payload.lang, 'Summary metric', 'Métrica resumen'),
          this.tx(payload.lang, 'Value', 'Valor'),
        ],
        regulatoryData.summaryRows,
        [0.56, 0.44],
        6,
      );
      doc.moveDown(0.8);

      if (regulatoryData.checkRows.length > 0) {
        this.drawSectionLabel(
          doc,
          payload,
          this.tx(
            payload.lang,
            'Regulatory checks',
            'Verificaciones regulatorias',
          ),
        );
        this.drawTable(
          doc,
          payload,
          [
            this.tx(payload.lang, 'Check', 'Verificación'),
            this.tx(payload.lang, 'Current', 'Actual'),
            this.tx(payload.lang, 'Threshold', 'Umbral'),
            this.tx(payload.lang, 'Status', 'Estado'),
          ],
          regulatoryData.checkRows,
          [0.42, 0.18, 0.2, 0.2],
          6,
        );
        doc.moveDown(0.8);
      }

      if (regulatoryData.notes.length > 0) {
        this.drawSectionLabel(
          doc,
          payload,
          this.tx(payload.lang, 'Observations', 'Observaciones'),
        );
        regulatoryData.notes.slice(0, 5).forEach((note) => {
          this.ensureSpace(doc, 28, payload, 6);
          doc
            .fillColor(REPORT_THEME.body)
            .font('Helvetica')
            .fontSize(9)
            .text(`• ${note}`, doc.page.margins.left, doc.y, {
              width:
                doc.page.width - doc.page.margins.left - doc.page.margins.right,
            });
          doc.moveDown(0.65);
        });
      }
    }

    this.drawFooter(doc, payload, 6);
  }

  private renderRecommendationsPage(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    watermark: string | null,
  ) {
    doc.addPage();
    this.drawWatermark(doc, watermark);
    this.drawPageHeader(
      doc,
      payload,
      this.tx(payload.lang, 'Board actions', 'Acciones de junta'),
      this.tx(
        payload.lang,
        'Priority actions from the current ALM posture',
        'Acciones prioritarias según la postura ALM actual',
      ),
      7,
    );

    payload.recommendations.forEach((recommendation, index) => {
      this.ensureSpace(doc, 78, payload, 7);
      const tone =
        recommendation.priority === 'HIGH'
          ? 'danger'
          : recommendation.priority === 'MEDIUM'
            ? 'warning'
            : 'success';
      this.drawTonePanel(
        doc,
        doc.page.margins.left,
        doc.y,
        doc.page.width - doc.page.margins.left - doc.page.margins.right,
        64,
        tone,
        `${index + 1}. ${recommendation.priority}`,
      );
      doc
        .fillColor(REPORT_THEME.body)
        .font('Helvetica')
        .fontSize(9.5)
        .text(recommendation.text, doc.page.margins.left + 14, doc.y + 24, {
          width:
            doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right -
            28,
        });
      doc.y += 78;
    });

    if (payload.availabilityNotes.length > 0) {
      this.drawSectionLabel(
        doc,
        payload,
        this.tx(payload.lang, 'Data completeness', 'Integridad de datos'),
      );
      payload.availabilityNotes.forEach((note) => {
        this.ensureSpace(doc, 24, payload, 7);
        doc
          .fillColor(REPORT_THEME.body)
          .font('Helvetica')
          .fontSize(8.5)
          .text(`• ${note}`, doc.page.margins.left, doc.y, {
            width:
              doc.page.width - doc.page.margins.left - doc.page.margins.right,
          });
        doc.moveDown(0.5);
      });
    }

    doc.moveDown(1.2);
    doc
      .fillColor(REPORT_THEME.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        this.tx(
          payload.lang,
          'This document is generated from the latest available ALM, balance-sheet, liquidity, and regulatory data in CERNIQ. Review all assumptions before taking action.',
          'Este documento se genera con la información ALM, de balance, liquidez y regulatoria más reciente disponible en CERNIQ. Revise todos los supuestos antes de actuar.',
        ),
        doc.page.margins.left,
        doc.y,
        {
          width:
            doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: 'center',
        },
      );

    this.drawFooter(doc, payload, 7);
  }

  private drawPageHeader(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    title: string,
    subtitle: string,
    pageNumber: number,
  ) {
    doc.rect(0, 0, doc.page.width, 5).fill(REPORT_THEME.brand);
    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(title, doc.page.margins.left, 48);
    doc
      .fillColor(REPORT_THEME.muted)
      .font('Helvetica')
      .fontSize(8.5)
      .text(subtitle, doc.page.margins.left, 68);
    doc
      .fillColor(REPORT_THEME.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${payload.institutionName} | ${payload.primaryRegulator}`,
        doc.page.margins.left,
        82,
      );
    doc.text(`${pageNumber}`, 0, 50, {
      width: doc.page.width - doc.page.margins.right,
      align: 'right',
    });
    doc.y = 104;
  }

  private drawFooter(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    pageNumber: number,
  ) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const y = doc.page.height - 34;
    doc
      .moveTo(left, y - 10)
      .lineTo(left + width, y - 10)
      .lineWidth(0.4)
      .strokeColor(REPORT_THEME.border)
      .stroke();
    doc
      .fillColor(REPORT_THEME.muted)
      .font('Helvetica')
      .fontSize(7)
      .text(payload.institutionName, left, y, { width: width / 3 });
    doc.text('CERNIQ | KLYTICS', left + width / 3, y, {
      width: width / 3,
      align: 'center',
    });
    doc.text(
      `${payload.generatedAtLabel} | ${pageNumber}`,
      left + (width * 2) / 3,
      y,
      {
        width: width / 3,
        align: 'right',
      },
    );
  }

  private drawMetricCards(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    startY: number,
    metrics: ReportMetric[],
  ): number {
    const left = doc.page.margins.left;
    const gutter = 12;
    const totalWidth = doc.page.width - left - doc.page.margins.right;
    const columnWidth = (totalWidth - gutter) / 2;
    const cardHeight = 58;

    metrics.forEach((metric, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = left + col * (columnWidth + gutter);
      const y = startY + row * (cardHeight + gutter);
      this.drawTonePanel(
        doc,
        x,
        y,
        columnWidth,
        cardHeight,
        metric.tone || 'neutral',
        metric.label,
      );
      doc
        .fillColor(REPORT_THEME.heading)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(metric.value, x + 12, y + 22, { width: columnWidth - 24 });
      if (metric.helper) {
        doc
          .fillColor(REPORT_THEME.muted)
          .font('Helvetica')
          .fontSize(7.5)
          .text(metric.helper, x + 12, y + 39, { width: columnWidth - 24 });
      }
    });

    const rows = Math.ceil(metrics.length / 2);
    return rows > 0 ? rows * cardHeight + (rows - 1) * gutter : 0;
  }

  private drawTable(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    headers: string[],
    rows: ReportTableRow[],
    widthRatios: number[],
    pageNumber: number,
  ) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const normalized = normalizeWidthRatios(widthRatios, width);
    const rowPadding = 6;
    const sectionTop = () => {
      doc.rect(left, doc.y, width, 20).fill(REPORT_THEME.dark);
      let cursor = left;
      headers.forEach((header, index) => {
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(header, cursor + rowPadding, doc.y + 6, {
            width: normalized[index] - rowPadding * 2,
            align: index === 0 ? 'left' : 'right',
          });
        cursor += normalized[index];
      });
      doc.y += 22;
    };

    sectionTop();

    rows.forEach((row, rowIndex) => {
      const rowHeight =
        Math.max(
          ...row.cells.map((cell, index) =>
            doc.heightOfString(cell, {
              width: normalized[index] - rowPadding * 2,
              align: index === 0 ? 'left' : 'right',
            }),
          ),
        ) +
        rowPadding * 1.6;
      this.ensureSpace(doc, rowHeight + 6, payload, pageNumber);
      if (doc.y + rowHeight > doc.page.height - 70) {
        this.drawFooter(doc, payload, pageNumber);
        doc.addPage();
        this.drawPageHeader(
          doc,
          payload,
          payload.lang === 'es' ? 'Continuación' : 'Continued',
          payload.institutionName,
          pageNumber,
        );
        sectionTop();
      }

      const tone = row.tone || (rowIndex % 2 === 1 ? 'info' : 'neutral');
      const { fill, accent, text } = toneColors(tone);
      this.drawPanel(doc, left, doc.y, width, rowHeight, fill, accent);

      let cursor = left;
      row.cells.forEach((cell, index) => {
        doc
          .fillColor(text)
          .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .text(cell, cursor + rowPadding, doc.y + 5, {
            width: normalized[index] - rowPadding * 2,
            align: index === 0 ? 'left' : 'right',
          });
        cursor += normalized[index];
      });
      doc.y += rowHeight + 6;
    });
  }

  private drawSectionLabel(
    doc: typeof PDFDocument,
    payload: ALMReportPayload,
    title: string,
  ) {
    this.ensureSpace(doc, 24, payload, 0);
    doc
      .fillColor(REPORT_THEME.heading)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title, doc.page.margins.left, doc.y);
    doc.moveDown(0.35);
  }

  private drawUnavailablePanel(
    doc: typeof PDFDocument,
    text: string,
    payload: ALMReportPayload,
  ) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    this.drawPanel(
      doc,
      left,
      doc.y,
      width,
      72,
      REPORT_THEME.warningBg,
      REPORT_THEME.warning,
    );
    doc
      .fillColor(REPORT_THEME.warning)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        this.tx(
          payload.lang,
          'Section available with limited data',
          'Sección disponible con datos limitados',
        ),
        left + 14,
        doc.y + 12,
      );
    doc
      .fillColor(REPORT_THEME.body)
      .font('Helvetica')
      .fontSize(9)
      .text(text, left + 14, doc.y + 30, {
        width: width - 28,
      });
    doc.y += 84;
  }

  private drawTonePanel(
    doc: typeof PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    tone: ReportTone,
    title: string,
  ) {
    const { fill, accent } = toneColors(tone);
    this.drawPanel(doc, x, y, width, height, fill, accent);
    if (title) {
      doc
        .fillColor(accent)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(title, x + 12, y + 10, { width: width - 24 });
    }
  }

  private drawPanel(
    doc: typeof PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor: string,
    accentColor: string,
  ) {
    doc.rect(x, y, width, height).fill(fillColor);
    doc.rect(x, y, 4, height).fill(accentColor);
  }

  private drawWatermark(doc: typeof PDFDocument, watermark: string | null) {
    if (!watermark) {
      return;
    }

    doc.save();
    doc.rotate(-24, { origin: [306, 396] });
    doc
      .fillColor('#cbd5e1')
      .opacity(0.28)
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(watermark, 84, 350, { width: 440, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }

  private ensureSpace(
    doc: typeof PDFDocument,
    height: number,
    payload: ALMReportPayload,
    pageNumber: number,
  ) {
    if (doc.y + height <= doc.page.height - 60) {
      return;
    }

    this.drawFooter(doc, payload, pageNumber);
    doc.addPage();
    this.drawPageHeader(
      doc,
      payload,
      payload.lang === 'es' ? 'Continuación' : 'Continued',
      payload.institutionName,
      pageNumber,
    );
  }

  private humanizeInstitutionType(type: string | null | undefined): string {
    if (!type) {
      return 'Institution';
    }

    return String(type)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private humanizeRiskProfile(
    profile: string | null | undefined,
    lang: ReportLanguage,
  ): string {
    if (!profile) {
      return this.unavailable(lang);
    }

    const normalized = String(profile).replace(/-/g, ' ');
    if (lang === 'es') {
      if (normalized === 'asset sensitive') return 'sensibilidad activa';
      if (normalized === 'liability sensitive') return 'sensibilidad pasiva';
      if (normalized === 'neutral') return 'perfil neutral';
    }
    return normalized;
  }

  private buildUnavailableNote(
    lang: ReportLanguage,
    label: string,
    error: unknown,
  ): string {
    const message =
      error instanceof Error && error.message
        ? error.message
        : this.tx(lang, 'service unavailable', 'servicio no disponible');
    return this.tx(
      lang,
      `${label} is unavailable in this export: ${message}.`,
      `${label} no está disponible en esta exportación: ${message}.`,
    );
  }

  private tx(lang: ReportLanguage, en: string, es: string): string {
    return lang === 'es' ? es : en;
  }

  private unavailable(lang: ReportLanguage): string {
    return this.tx(lang, 'Unavailable', 'No disponible');
  }
}

function normalizeWidthRatios(ratios: number[], width: number): number[] {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0) || 1;
  return ratios.map((ratio) => (ratio / total) * width);
}

function toneColors(tone: ReportTone): {
  fill: string;
  accent: string;
  text: string;
} {
  switch (tone) {
    case 'success':
      return {
        fill: REPORT_THEME.successBg,
        accent: REPORT_THEME.success,
        text: REPORT_THEME.heading,
      };
    case 'warning':
      return {
        fill: REPORT_THEME.warningBg,
        accent: REPORT_THEME.warning,
        text: REPORT_THEME.heading,
      };
    case 'danger':
      return {
        fill: REPORT_THEME.dangerBg,
        accent: REPORT_THEME.danger,
        text: REPORT_THEME.heading,
      };
    case 'info':
      return {
        fill: REPORT_THEME.infoBg,
        accent: REPORT_THEME.info,
        text: REPORT_THEME.heading,
      };
    default:
      return {
        fill: REPORT_THEME.panel,
        accent: REPORT_THEME.brandAlt,
        text: REPORT_THEME.heading,
      };
  }
}

function scoreTone(metrics: ReportMetric[]): ReportTone {
  return (
    metrics.find((metric) => metric.label.toLowerCase().includes('capital'))
      ?.tone || 'info'
  );
}
