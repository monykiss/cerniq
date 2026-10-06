import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  AlmEnterpriseService,
  ALMSummaryResult,
} from './alm-enterprise.service';
import { AlmAdvisorV2Service } from './alm-advisor-v2.service';
import { CAMELScorerService } from './exam-prep/camel-scorer.service';
import { DataGap, dataGap, mergeGaps } from './reports/data-gap';

function round(v: number, decimals: number): number {
  if (!Number.isFinite(v)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// ─── Types ───────────────────────────────────────────────────

export interface BoardReportSection {
  title: string;
  titleEs: string;
  pageRange: string;
  content: Record<string, any>;
}

/**
 * Board report. D1 (2026-04-07): every numeric KPI is nullable. When
 * `gaps[]` contains any CRITICAL entry, the report should not be sent
 * to the board — affected KPIs render as `—` and a banner above the
 * report explains what's missing.
 *
 * Previously every KPI had a hardcoded fallback (NIM=3.5, LCR=115,
 * NSFR=108, NWR=9.2, EVE=15.2, NPL=1.8, CECL=1.3, ROA=0.82). A board
 * director reading those numbers assumed they reflected their cooperativa.
 * They reflected nothing. This was the worst silent-fallback pattern in
 * the codebase. Read SESSION_HANDOFF.md §6 before reverting.
 */
export interface BoardReportData {
  institutionName: string;
  reportMonth: string;
  generatedAt: string;
  camelComposite: number;
  sections: BoardReportSection[];
  kpis: {
    nim: number | null;
    lcr: number | null;
    nsfr: number | null;
    nwr: number | null;
    eveSensitivity: number | null;
    nplRatio: number | null;
    ceclCoverage: number | null;
    roa: number | null;
  };
  topRisks: string[];
  topRisksEs: string[];
  recommendations: string[];
  recommendationsEs: string[];
  regPulse: Array<{
    deadline: string;
    deadlineEs: string;
    date: string;
    urgency: string;
  }>;
  gaps?: DataGap[];
}

@Injectable()
export class BoardReportService {
  private readonly logger = new Logger(BoardReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly advisorV2: AlmAdvisorV2Service,
    private readonly camelScorer: CAMELScorerService,
  ) {}

  async generateBoardReportData(
    institutionId: string,
  ): Promise<BoardReportData> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    const now = new Date();
    const reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // D1 (2026-04-07): never silently swallow ALM failures. Capture the
    // error into a gap so the board report explicitly says "ALM data
    // unavailable" instead of falling back to phantom KPIs.
    let summary: ALMSummaryResult | null = null;
    let summaryError: string | null = null;
    try {
      summary = await this.almEnterprise.getALMSummary(institutionId);
    } catch (err) {
      summaryError = err instanceof Error ? err.message : String(err);
      this.logger.warn({
        event: 'board_report_summary_failed',
        institutionId,
        reason: summaryError,
      });
    }

    const healthScore = await this.advisorV2.computeHealthScore(institutionId);
    const camel = await this.camelScorer.scoreInstitution(institutionId);

    // D1: derive every KPI from the ALM summary. When the summary is null
    // or the underlying field is null/data_unavailable, the KPI is null
    // (not a hardcoded fallback). Each null adds a CRITICAL gap to the
    // top-level result so the board sees DATA UNAVAILABLE markers and the
    // accompanying banner instead of phantom numbers.
    const totalAssetsM = institution?.totalAssets
      ? Number(institution.totalAssets)
      : null;
    const baseNII =
      summary && Number.isFinite(summary.niiSensitivity?.baseNII)
        ? summary.niiSensitivity.baseNII
        : null;
    const nim =
      baseNII !== null && totalAssetsM !== null && totalAssetsM > 0
        ? round((baseNII / totalAssetsM) * 100, 2)
        : null;

    const lcr =
      summary?.liquidity?.lcr !== null && summary?.liquidity?.lcr !== undefined
        ? Number(summary.liquidity.lcr)
        : null;

    // NSFR, NPL, CECL coverage, ROA, EVE sensitivity are not yet wired to
    // real sources. Surface them as null + WARNING gaps so the board sees
    // DATA UNAVAILABLE markers and reviewers know which KPIs still need
    // real data sources. Each WARNING gap names the field and the action
    // needed to fix it. Tracked in SESSION_HANDOFF.md.
    const kpis: BoardReportData['kpis'] = {
      nim,
      lcr,
      nsfr: null,
      nwr:
        totalAssetsM !== null &&
        totalAssetsM > 0 &&
        summary?.fullAnalysis?.summary?.equity !== undefined
          ? round(
              (Number(summary.fullAnalysis.summary.equity) / totalAssetsM) *
                100,
              2,
            )
          : null,
      eveSensitivity: null,
      nplRatio: null,
      ceclCoverage: null,
      roa: null,
    };

    const sections: BoardReportSection[] = [
      {
        title: 'Executive Summary',
        titleEs: 'Resumen Ejecutivo',
        pageRange: '2',
        content: {
          healthScore: healthScore.overall,
          label: healthScore.label,
          camelComposite: camel.composite,
        },
      },
      {
        title: 'Key Metrics Dashboard',
        titleEs: 'Panel de Indicadores Clave',
        pageRange: '3-4',
        content: { kpis },
      },
      {
        title: 'Risk Trend Analysis',
        titleEs: 'Análisis de Tendencia de Riesgo',
        pageRange: '5-7',
        content: { alerts: this.advisorV2.rankAlerts(healthScore) },
      },
      {
        title: 'Peer Comparison',
        titleEs: 'Comparación con Pares',
        pageRange: '8-9',
        content: { peerGroup: 'PR Cooperativas', assetTier: 'medium' },
      },
      {
        title: 'Forward Projection (3-Year)',
        titleEs: 'Proyección Forward (3 Años)',
        pageRange: '10-11',
        content: { horizon: 3, ratePaths: ['base', 'up200', 'down100'] },
      },
      {
        title: 'Recommended Actions',
        titleEs: 'Acciones Recomendadas',
        pageRange: '13-14',
        content: { count: 5 },
      },
      {
        title: 'Regulatory Pulse',
        titleEs: 'Pulso Regulatorio',
        pageRange: '15',
        content: { days: 90 },
      },
    ];

    // D1: derive top risks and recommendations from the ALM summary's
    // computed narratives. When the summary is null, surface a single
    // explicit "data unavailable" line in both languages instead of
    // hardcoded fake-specific risk strings ("CRE concentration at 27%"
    // — that 27% was a literal in the source code, not a measured value).
    const topRisks: string[] =
      summary?.topRisks && summary.topRisks.length > 0
        ? summary.topRisks
        : [
            'ALM data unavailable — top risks cannot be assessed. See gaps manifest.',
          ];
    const topRisksEs: string[] =
      summary?.topRisks && summary.topRisks.length > 0
        ? summary.topRisks // ALMSummary.topRisks is currently English-only; future: bilingual
        : [
            'Datos ALM no disponibles — los riesgos principales no pueden evaluarse. Ver manifiesto de brechas.',
          ];

    const recommendations: string[] =
      summary?.recommendations && summary.recommendations.length > 0
        ? summary.recommendations
        : [
            'Upload balance sheet and liquidity data to enable computed recommendations. ALM data is currently unavailable.',
          ];
    const recommendationsEs: string[] =
      summary?.recommendations && summary.recommendations.length > 0
        ? summary.recommendations
        : [
            'Cargue datos de balance y liquidez para habilitar recomendaciones computadas. Los datos ALM no están disponibles.',
          ];

    // ─── Gap manifest ───
    // Aggregate from the ALM summary (which already collects sub-call gaps),
    // and add board-report-specific gaps for KPIs that are not yet wired to
    // real sources. Each gap names the field and the action needed.
    const gaps: DataGap[] = mergeGaps(summary?.gaps);

    if (summary === null || summaryError !== null) {
      gaps.push(
        dataGap('board.almSummary', 'DEPENDENCY_REJECTED', {
          severity: 'CRITICAL',
          action:
            'getALMSummary() failed for this institution. Verify the institution has balance sheet items loaded and that the ALM service is reachable.',
          context: { institutionId, error: summaryError ?? 'null returned' },
        }),
      );
    }
    if (kpis.nim === null) {
      gaps.push(
        dataGap('board.kpis.nim', 'CALCULATION_FAILED', {
          severity: 'CRITICAL',
          action:
            'NIM cannot be computed without baseNII (from niiSensitivity) and a valid totalAssets.',
        }),
      );
    }
    if (kpis.lcr === null) {
      gaps.push(
        dataGap('board.kpis.lcr', 'NO_LIQUIDITY_POSITION', {
          severity: 'CRITICAL',
          action:
            'Upload a liquidity_positions row so the board report can show a real LCR.',
        }),
      );
    }
    // KPIs not yet wired to real sources — surface as WARNING gaps so the
    // board sees DATA UNAVAILABLE markers and reviewers see what's still
    // hardcoded-pending. Each one names the source it should come from.
    gaps.push(
      dataGap('board.kpis.nsfr', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire NSFR computation (LiquidityAdvancedService) into the board report KPIs. Currently surfaced as null.',
      }),
      dataGap('board.kpis.eveSensitivity', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire EVE sensitivity (DurationService.calculateEVESensitivity) into the board report KPIs. Currently surfaced as null.',
      }),
      dataGap('board.kpis.nplRatio', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire NPL ratio (CECL or delinquency source) into the board report KPIs. Currently surfaced as null.',
      }),
      dataGap('board.kpis.ceclCoverage', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire CECL coverage (CECLService) into the board report KPIs. Currently surfaced as null.',
      }),
      dataGap('board.kpis.roa', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire ROA computation (income statement source) into the board report KPIs. Currently surfaced as null.',
      }),
    );

    // Persist board report snapshot. The persist is genuinely non-critical
    // (it's a historical log, not the report itself) — but we LOG the
    // failure rather than silently swallow it. The previous `catch {}`
    // pattern hid persist outages from any monitoring.
    try {
      await this.prisma.boardReport.create({
        data: {
          institutionId,
          reportMonth,
          camelComposite: camel.composite,
          nimSnapshot: kpis.nim ?? 0,
          lcrSnapshot: kpis.lcr ?? 0,
          topRiskAlert: topRisks[0],
        },
      });
    } catch (err) {
      this.logger.warn({
        event: 'board_report_persist_failed',
        institutionId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    // Reg pulse: currently hardcoded with literal dates. Surfaced as a
    // WARNING gap until a real compliance-calendar source is wired in.
    // The dates below are still emitted so the existing UI doesn't break,
    // but they should be replaced with ComplianceCalendarService output.
    gaps.push(
      dataGap('board.regPulse', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          "Wire ComplianceCalendarService into the board report so reg pulse dates come from the institution's actual schedule, not hardcoded literals.",
      }),
    );

    return {
      institutionName: institution?.name ?? 'Institution',
      reportMonth,
      generatedAt: now.toISOString(),
      camelComposite: camel.composite,
      sections,
      kpis,
      topRisks,
      topRisksEs,
      recommendations,
      recommendationsEs,
      regPulse: [
        {
          deadline: 'COSSEC Quarterly Report',
          deadlineEs: 'Informe Trimestral COSSEC',
          date: '2026-04-15',
          urgency: 'HIGH',
        },
        {
          deadline: 'ALCO Committee Meeting',
          deadlineEs: 'Reunión Comité ALCO',
          date: '2026-04-01',
          urgency: 'MEDIUM',
        },
        {
          deadline: 'NCUA 5300 Filing',
          deadlineEs: 'Radicación NCUA 5300',
          date: '2026-04-30',
          urgency: 'HIGH',
        },
      ],
      gaps,
    };
  }
}
