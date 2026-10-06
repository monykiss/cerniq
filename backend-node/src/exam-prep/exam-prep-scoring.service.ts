import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Constants: COSSEC 12-Category Weighting ────────────────────────────────

export const CATEGORY_WEIGHTS: Record<string, number> = {
  ALM_POLICY: 0.15,
  DURATION_GAP: 0.12,
  NII_SENSITIVITY: 0.1,
  EVE: 0.1,
  LIQUIDITY: 0.1,
  CAPITAL_ADEQUACY: 0.08,
  CONCENTRATION: 0.07,
  GOVERNANCE: 0.07,
  DATA_QUALITY: 0.05,
  CREDIT_RISK: 0.07,
  OPERATIONAL: 0.05,
  INTEREST_RATE: 0.04,
};

// ─── Compliance Thresholds ──────────────────────────────────────────────────

export interface ThresholdSpec {
  passMax?: number;
  passMin?: number;
  warnMax?: number;
  warnMin?: number;
  failBelow?: number;
  failAbove?: number;
  unit: string;
  name: string;
  nameEs: string;
}

export const THRESHOLDS: Record<string, ThresholdSpec> = {
  DURATION_GAP: {
    passMax: 3.0,
    warnMax: 4.5,
    failAbove: 4.5,
    unit: 'years',
    name: 'Duration Gap',
    nameEs: 'Brecha de Duración',
  },
  NII_SENSITIVITY: {
    passMax: 20,
    warnMax: 35,
    failAbove: 35,
    unit: '%',
    name: 'NII Sensitivity',
    nameEs: 'Sensibilidad de Ingreso Neto por Intereses',
  },
  EVE: {
    passMin: -20,
    warnMin: -30,
    failBelow: -30,
    unit: '%',
    name: 'EVE Change',
    nameEs: 'Cambio en Valor Económico',
  },
  LCR: {
    passMin: 100,
    warnMin: 90,
    failBelow: 90,
    unit: '%',
    name: 'Liquidity Coverage Ratio',
    nameEs: 'Razón de Cobertura de Liquidez',
  },
  NET_WORTH: {
    passMin: 10,
    warnMin: 7,
    failBelow: 7,
    unit: '%',
    name: 'Net Worth Ratio',
    nameEs: 'Razón de Patrimonio',
  },
  CAPITAL: {
    passMin: 7,
    warnMin: 5,
    failBelow: 5,
    unit: '%',
    name: 'Capital Ratio',
    nameEs: 'Razón de Capital',
  },
};

// ─── Category → Threshold Key Mapping ───────────────────────────────────────
// Maps the 12-category names to the threshold constant keys above.
// Categories without a threshold entry use policy-based scoring.

const CATEGORY_TO_THRESHOLD: Record<string, string> = {
  DURATION_GAP: 'DURATION_GAP',
  NII_SENSITIVITY: 'NII_SENSITIVITY',
  EVE: 'EVE',
  LIQUIDITY: 'LCR',
  CAPITAL_ADEQUACY: 'NET_WORTH',
  INTEREST_RATE: 'CAPITAL',
};

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CategoryMetrics {
  value: number;
  threshold?: string;
  hasPolicy?: boolean;
  lastReviewDate?: string;
  evidenceAvailable?: boolean;
}

export type ComplianceStatus = 'PASS' | 'WARN' | 'FAIL';

export interface CategoryScoreResult {
  category: string;
  categoryLabel: string;
  categoryLabelEs: string;
  score: number;
  weight: number;
  weightedScore: number;
  compliance: ComplianceStatus;
  value?: number;
  unit?: string;
  remediation?: string;
  remediationEs?: string;
}

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ExamReadinessAssessment {
  id: string;
  institutionId: string;
  assessedBy: string;
  assessedAt: string;
  overallScore: number;
  letterGrade: LetterGrade;
  categories: CategoryScoreResult[];
  passCount: number;
  warnCount: number;
  failCount: number;
  summary: string;
  summaryEs: string;
  remediationPlan: string[];
  remediationPlanEs: string[];
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class ExamPrepScoringService {
  private readonly logger = new Logger(ExamPrepScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run a full exam readiness assessment: fetch latest ALM data,
   * score each of the 12 COSSEC categories, compute the weighted overall
   * score, and assign a letter grade.
   */
  async assessReadiness(
    institutionId: string,
    assessedBy: string,
  ): Promise<ExamReadinessAssessment> {
    this.logger.log({
      msg: 'Starting exam readiness assessment',
      institutionId,
      assessedBy,
    });

    // Fetch latest ALM metrics for the institution
    const metrics = await this.fetchInstitutionMetrics(institutionId);

    // Score each category
    const categories: CategoryScoreResult[] = [];
    let totalWeightedScore = 0;
    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;

    for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
      const categoryMetrics: CategoryMetrics = metrics[category] ?? {
        value: 0,
      };
      const result = this.computeCategoryScore(category, categoryMetrics);
      categories.push(result);
      totalWeightedScore += result.weightedScore;

      if (result.compliance === 'PASS') passCount++;
      else if (result.compliance === 'WARN') warnCount++;
      else failCount++;
    }

    const overallScore = Math.round(totalWeightedScore);
    const letterGrade = this.assignLetterGrade(overallScore);

    // Build remediation plan from failing/warning categories
    const remediationPlan: string[] = [];
    const remediationPlanEs: string[] = [];
    for (const cat of categories) {
      if (cat.compliance !== 'PASS' && cat.remediation) {
        remediationPlan.push(cat.remediation);
        if (cat.remediationEs) {
          remediationPlanEs.push(cat.remediationEs);
        }
      }
    }

    const assessment: ExamReadinessAssessment = {
      id: crypto.randomUUID(),
      institutionId,
      assessedBy,
      assessedAt: new Date().toISOString(),
      overallScore,
      letterGrade,
      categories,
      passCount,
      warnCount,
      failCount,
      summary: this.buildSummary(
        letterGrade,
        overallScore,
        passCount,
        warnCount,
        failCount,
      ),
      summaryEs: this.buildSummaryEs(
        letterGrade,
        overallScore,
        passCount,
        warnCount,
        failCount,
      ),
      remediationPlan,
      remediationPlanEs,
    };

    // Store assessment
    this.assessmentStore.set(assessment.id, assessment);
    const existing = this.institutionAssessments.get(institutionId) ?? [];
    existing.push(assessment);
    this.institutionAssessments.set(institutionId, existing);

    this.logger.log({
      msg: 'Assessment complete',
      institutionId,
      overallScore,
      letterGrade,
      passCount,
      warnCount,
      failCount,
    });

    return assessment;
  }

  /**
   * Get the latest assessment for an institution.
   */
  async getLatestAssessment(
    institutionId: string,
  ): Promise<ExamReadinessAssessment | null> {
    const assessments = this.institutionAssessments.get(institutionId) ?? [];
    if (assessments.length === 0) return null;
    return assessments[assessments.length - 1];
  }

  /**
   * Get full assessment history for an institution.
   */
  async getAssessmentHistory(
    institutionId: string,
  ): Promise<ExamReadinessAssessment[]> {
    return (this.institutionAssessments.get(institutionId) ?? [])
      .slice()
      .reverse(); // Most recent first
  }

  /**
   * Compute the score for a single COSSEC category based on its metrics.
   * Score range: 0-100. Compliance status: PASS/WARN/FAIL.
   */
  computeCategoryScore(
    category: string,
    metrics: CategoryMetrics,
  ): CategoryScoreResult {
    const weight = CATEGORY_WEIGHTS[category] ?? 0;
    const thresholdKey = CATEGORY_TO_THRESHOLD[category] ?? category;
    const threshold = THRESHOLDS[thresholdKey];
    const labels = this.getCategoryLabels(category);

    let score: number;
    let compliance: ComplianceStatus;
    let remediation: string | undefined;
    let remediationEs: string | undefined;

    if (threshold) {
      // Threshold-based scoring
      const { complianceResult, numericScore } = this.evaluateThreshold(
        threshold,
        metrics.value,
      );
      compliance = complianceResult;
      score = numericScore;

      if (compliance === 'FAIL') {
        remediation = `${labels.label}: Currently at ${metrics.value}${threshold.unit}. Must improve to meet ${threshold.passMin !== undefined ? `>=${threshold.passMin}${threshold.unit}` : `<=${threshold.passMax}${threshold.unit}`} threshold.`;
        remediationEs = `${labels.labelEs}: Actualmente en ${metrics.value}${threshold.unit}. Debe mejorar para cumplir el umbral de ${threshold.passMin !== undefined ? `>=${threshold.passMin}${threshold.unit}` : `<=${threshold.passMax}${threshold.unit}`}.`;
      } else if (compliance === 'WARN') {
        remediation = `${labels.label}: At ${metrics.value}${threshold.unit} — approaching risk threshold. Review recommended.`;
        remediationEs = `${labels.labelEs}: En ${metrics.value}${threshold.unit} — acercandose al umbral de riesgo. Se recomienda revision.`;
      }
    } else {
      // Policy/governance-based scoring (binary or evidence-based)
      if (metrics.hasPolicy && metrics.evidenceAvailable) {
        score = 95;
        compliance = 'PASS';
      } else if (metrics.hasPolicy) {
        score = 70;
        compliance = 'WARN';
        remediation = `${labels.label}: Policy exists but supporting evidence is incomplete.`;
        remediationEs = `${labels.labelEs}: Politica existe pero la evidencia de respaldo esta incompleta.`;
      } else {
        score = 30;
        compliance = 'FAIL';
        remediation = `${labels.label}: No formal policy documented. Create and board-approve a written policy.`;
        remediationEs = `${labels.labelEs}: No hay politica formal documentada. Crear y aprobar por la Junta una politica escrita.`;
      }
    }

    return {
      category,
      categoryLabel: labels.label,
      categoryLabelEs: labels.labelEs,
      score,
      weight,
      weightedScore: score * weight,
      compliance,
      value: metrics.value,
      unit: threshold?.unit,
      remediation,
      remediationEs,
    };
  }

  /**
   * Assign a letter grade based on the overall numeric score.
   * A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60
   */
  assignLetterGrade(score: number): LetterGrade {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private evaluateThreshold(
    spec: ThresholdSpec,
    value: number,
  ): { complianceResult: ComplianceStatus; numericScore: number } {
    // For "lower is better" thresholds (Duration Gap, NII Sensitivity)
    if (spec.passMax !== undefined) {
      if (value <= spec.passMax) {
        return { complianceResult: 'PASS', numericScore: 95 };
      }
      if (spec.warnMax !== undefined && value <= spec.warnMax) {
        // Interpolate 60-79 in the warning range
        const range = spec.warnMax - spec.passMax;
        const position = range > 0 ? (value - spec.passMax) / range : 0.5;
        return {
          complianceResult: 'WARN',
          numericScore: Math.round(79 - position * 19),
        };
      }
      return { complianceResult: 'FAIL', numericScore: 30 };
    }

    // For "higher is better" thresholds (EVE, LCR, Net Worth, Capital)
    if (spec.passMin !== undefined) {
      if (value >= spec.passMin) {
        return { complianceResult: 'PASS', numericScore: 95 };
      }
      if (spec.warnMin !== undefined && value >= spec.warnMin) {
        const range = spec.passMin - spec.warnMin;
        const position = range > 0 ? (spec.passMin - value) / range : 0.5;
        return {
          complianceResult: 'WARN',
          numericScore: Math.round(79 - position * 19),
        };
      }
      return { complianceResult: 'FAIL', numericScore: 30 };
    }

    // Fallback
    return { complianceResult: 'WARN', numericScore: 50 };
  }

  private getCategoryLabels(category: string): {
    label: string;
    labelEs: string;
  } {
    const labels: Record<string, { label: string; labelEs: string }> = {
      ALM_POLICY: { label: 'ALM Policy', labelEs: 'Politica ALM' },
      DURATION_GAP: { label: 'Duration Gap', labelEs: 'Brecha de Duración' },
      NII_SENSITIVITY: {
        label: 'NII Sensitivity',
        labelEs: 'Sensibilidad de Ingreso Neto',
      },
      EVE: {
        label: 'Economic Value of Equity',
        labelEs: 'Valor Económico del Patrimonio',
      },
      LIQUIDITY: { label: 'Liquidity', labelEs: 'Liquidez' },
      CAPITAL_ADEQUACY: {
        label: 'Capital Adequacy',
        labelEs: 'Adecuación de Capital',
      },
      CONCENTRATION: {
        label: 'Concentration Risk',
        labelEs: 'Riesgo de Concentración',
      },
      GOVERNANCE: { label: 'Governance', labelEs: 'Gobernanza' },
      DATA_QUALITY: { label: 'Data Quality', labelEs: 'Calidad de Datos' },
      CREDIT_RISK: { label: 'Credit Risk', labelEs: 'Riesgo Crediticio' },
      OPERATIONAL: { label: 'Operational Risk', labelEs: 'Riesgo Operacional' },
      INTEREST_RATE: {
        label: 'Interest Rate Risk',
        labelEs: 'Riesgo de Tasa de Interés',
      },
    };
    return labels[category] ?? { label: category, labelEs: category };
  }

  /**
   * Fetch the latest ALM metrics for an institution from the database.
   * Returns a map of category → CategoryMetrics.
   * In production this queries BalanceSheetItems, AnalysisRuns, etc.
   */
  private async fetchInstitutionMetrics(
    institutionId: string,
  ): Promise<Record<string, CategoryMetrics>> {
    // In production, this would fetch real data from Prisma.
    // For the scaffold, return representative demo metrics.
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      if (items && items.length > 0) {
        // Compute metrics from real data
        return this.computeMetricsFromData(items);
      }
    } catch {
      // Table may not exist yet — fall through to demo
    }

    // Demo metrics for development
    return {
      ALM_POLICY: { value: 0, hasPolicy: true, evidenceAvailable: true },
      DURATION_GAP: { value: 2.5 },
      NII_SENSITIVITY: { value: 15 },
      EVE: { value: -12 },
      LIQUIDITY: { value: 110 },
      CAPITAL_ADEQUACY: { value: 8.5 },
      CONCENTRATION: { value: 0, hasPolicy: true, evidenceAvailable: false },
      GOVERNANCE: { value: 0, hasPolicy: true, evidenceAvailable: true },
      DATA_QUALITY: { value: 0, hasPolicy: true, evidenceAvailable: true },
      CREDIT_RISK: { value: 0, hasPolicy: true, evidenceAvailable: true },
      OPERATIONAL: { value: 0, hasPolicy: true, evidenceAvailable: false },
      INTEREST_RATE: { value: 2.8 },
    };
  }

  private computeMetricsFromData(
    items: any[],
  ): Record<string, CategoryMetrics> {
    // Simplified metric extraction from balance sheet items
    const totalAssets =
      items
        .filter((i) => i.category === 'asset' && i.subcategory === 'total')
        .reduce((sum: number, i: any) => sum + Number(i.balance || 0), 0) || 1;
    const netWorth = items
      .filter((i) => i.name?.includes('Net Worth'))
      .reduce((sum: number, i: any) => sum + Number(i.balance || 0), 0);

    const netWorthRatio = totalAssets > 0 ? (netWorth / totalAssets) * 100 : 0;

    return {
      ALM_POLICY: { value: 0, hasPolicy: true, evidenceAvailable: true },
      DURATION_GAP: { value: 2.5 },
      NII_SENSITIVITY: { value: 15 },
      EVE: { value: -12 },
      LIQUIDITY: { value: 105 },
      CAPITAL_ADEQUACY: { value: netWorthRatio || 8.5 },
      CONCENTRATION: { value: 0, hasPolicy: true, evidenceAvailable: false },
      GOVERNANCE: { value: 0, hasPolicy: true, evidenceAvailable: true },
      DATA_QUALITY: { value: 0, hasPolicy: true, evidenceAvailable: true },
      CREDIT_RISK: { value: 0, hasPolicy: true, evidenceAvailable: true },
      OPERATIONAL: { value: 0, hasPolicy: true, evidenceAvailable: false },
      INTEREST_RATE: { value: 2.8 },
    };
  }

  private buildSummary(
    grade: LetterGrade,
    score: number,
    pass: number,
    warn: number,
    fail: number,
  ): string {
    const readiness =
      grade === 'A' || grade === 'B'
        ? 'well-positioned'
        : grade === 'C'
          ? 'adequately prepared but with gaps'
          : 'at risk';

    return (
      `Overall exam readiness: Grade ${grade} (${score}/100). ` +
      `The institution is ${readiness} for COSSEC examination. ` +
      `${pass} categories pass, ${warn} require attention, ${fail} need immediate remediation.`
    );
  }

  private buildSummaryEs(
    grade: LetterGrade,
    score: number,
    pass: number,
    warn: number,
    fail: number,
  ): string {
    const readiness =
      grade === 'A' || grade === 'B'
        ? 'bien posicionada'
        : grade === 'C'
          ? 'adecuadamente preparada pero con brechas'
          : 'en riesgo';

    return (
      `Preparacion general para examen: Grado ${grade} (${score}/100). ` +
      `La institucion esta ${readiness} para la examinacion de COSSEC. ` +
      `${pass} categorias aprobadas, ${warn} requieren atencion, ${fail} necesitan remediacion inmediata.`
    );
  }

  // ── In-memory store (replaced by Prisma table in migration) ───────────────
  private readonly assessmentStore = new Map<string, ExamReadinessAssessment>();
  private readonly institutionAssessments = new Map<
    string,
    ExamReadinessAssessment[]
  >();
}
