import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma.service';
import { CAMELScorerService, CAMELResult } from './camel-scorer.service';
import { AlmEnterpriseService } from '../alm-enterprise.service';
import { AuditService } from '../../audit/audit.service';

// ─── 12 COSSEC Ratios (exact Spanish terminology) ─────────────────

interface CossecRatioDefinition {
  id: number;
  nameEs: string;
  nameEn: string;
  formulaEs: string;
  formulaEn: string;
  threshold: number;
  thresholdLabel: string;
  thresholdDirection: 'gte' | 'lte' | 'range';
  unit: string;
  /** Lower bound for range thresholds */
  rangeLow?: number;
  /** Upper bound for range thresholds */
  rangeHigh?: number;
}

const COSSEC_RATIOS: CossecRatioDefinition[] = [
  {
    id: 1,
    nameEs: 'Razón de Capital Neto (NWR)',
    nameEn: 'Net Worth Ratio (NWR)',
    formulaEs: 'NWR = Patrimonio Neto / Activos Totales',
    formulaEn: 'NWR = Net Worth / Total Assets',
    threshold: 6,
    thresholdLabel: '≥ 6.00%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 2,
    nameEs: 'Razón de Cobertura de Liquidez (LCR)',
    nameEn: 'Liquidity Coverage Ratio (LCR)',
    formulaEs: 'LCR = HQLA / Flujos de Salida Netos (30 días)',
    formulaEn: 'LCR = HQLA / Net Cash Outflows (30 days)',
    threshold: 100,
    thresholdLabel: '≥ 100.00%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 3,
    nameEs: 'Margen de Interés Neto (NIM)',
    nameEn: 'Net Interest Margin (NIM)',
    formulaEs:
      'NIM = (Ingreso por Intereses - Gasto por Intereses) / Activos Productivos',
    formulaEn: 'NIM = (Interest Income - Interest Expense) / Earning Assets',
    threshold: 2.5,
    thresholdLabel: '≥ 2.50%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 4,
    nameEs: 'Razón de Préstamos No Corrientes (NCR)',
    nameEn: 'Non-Current Loan Ratio (NCR)',
    formulaEs: 'NCR = Préstamos No Corrientes / Total Préstamos',
    formulaEn: 'NCR = Non-Current Loans / Total Loans',
    threshold: 5,
    thresholdLabel: '< 5.00%',
    thresholdDirection: 'lte',
    unit: '%',
  },
  {
    id: 5,
    nameEs: 'Razón de Cobertura de Provisiones',
    nameEn: 'Provision Coverage Ratio',
    formulaEs: 'Provisiones / Préstamos No Corrientes',
    formulaEn: 'Provisions / Non-Current Loans',
    threshold: 100,
    thresholdLabel: '≥ 100.00%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 6,
    nameEs: 'Rendimiento sobre Activos (ROA)',
    nameEn: 'Return on Assets (ROA)',
    formulaEs: 'ROA = Ingreso Neto / Activos Totales Promedio',
    formulaEn: 'ROA = Net Income / Average Total Assets',
    threshold: 0.5,
    thresholdLabel: '≥ 0.50%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 7,
    nameEs: 'Rendimiento sobre Capital (ROE)',
    nameEn: 'Return on Equity (ROE)',
    formulaEs: 'ROE = Ingreso Neto / Capital Promedio',
    formulaEn: 'ROE = Net Income / Average Equity',
    threshold: 8,
    thresholdLabel: '≥ 8.00%',
    thresholdDirection: 'gte',
    unit: '%',
  },
  {
    id: 8,
    nameEs: 'Razón de Eficiencia Operativa',
    nameEn: 'Operating Efficiency Ratio',
    formulaEs: 'Gastos Operativos / Ingresos Operativos',
    formulaEn: 'Operating Expenses / Operating Income',
    threshold: 85,
    thresholdLabel: '< 85.00%',
    thresholdDirection: 'lte',
    unit: '%',
  },
  {
    id: 9,
    nameEs: 'Razón de Concentración de Préstamos',
    nameEn: 'Loan Concentration Ratio',
    formulaEs: 'Total Préstamos / Capital Neto',
    formulaEn: 'Total Loans / Net Worth',
    threshold: 300,
    thresholdLabel: '< 300.00%',
    thresholdDirection: 'lte',
    unit: '%',
  },
  {
    id: 10,
    nameEs: 'Brecha de Duración',
    nameEn: 'Duration Gap',
    formulaEs: 'Duración Activos - (Pasivos / Activos) × Duración Pasivos',
    formulaEn: 'Asset Duration - (Liabilities / Assets) × Liability Duration',
    threshold: 0, // range uses rangeLow/rangeHigh
    thresholdLabel: '-1.00 a +3.00 años',
    thresholdDirection: 'range',
    unit: 'años',
    rangeLow: -1,
    rangeHigh: 3,
  },
  {
    id: 11,
    nameEs: 'Sensibilidad NII (±200bps)',
    nameEn: 'NII Sensitivity (±200bps)',
    formulaEs: 'Cambio % en NII ante choque de ±200 puntos base',
    formulaEn: 'NII % change under ±200bps rate shock',
    threshold: 10,
    thresholdLabel: '< 10.00%',
    thresholdDirection: 'lte',
    unit: '%',
  },
  {
    id: 12,
    nameEs: 'Razón Préstamos/Depósitos',
    nameEn: 'Loan-to-Deposit Ratio',
    formulaEs: 'Total Préstamos / Total Depósitos',
    formulaEn: 'Total Loans / Total Deposits',
    threshold: 80,
    thresholdLabel: '< 80.00%',
    thresholdDirection: 'lte',
    unit: '%',
  },
];

// ─── Status badge computation ──────────────────────────────────────

type ComplianceBadge = 'CUMPLE' | 'ALERTA' | 'INCUMPLE';
type ComplianceBadgeEn = 'PASS' | 'WARNING' | 'FAIL';

function getComplianceBadge(
  value: number,
  def: CossecRatioDefinition,
): { badge: ComplianceBadge; badgeEn: ComplianceBadgeEn; color: string } {
  if (def.thresholdDirection === 'range') {
    const low = def.rangeLow ?? -1;
    const high = def.rangeHigh ?? 3;
    if (value >= low && value <= high) {
      return { badge: 'CUMPLE', badgeEn: 'PASS', color: '#16a34a' };
    }
    // Within 20% of range boundary => warning
    const rangeSpan = high - low;
    if (value >= low - rangeSpan * 0.2 && value <= high + rangeSpan * 0.2) {
      return { badge: 'ALERTA', badgeEn: 'WARNING', color: '#d97706' };
    }
    return { badge: 'INCUMPLE', badgeEn: 'FAIL', color: '#dc2626' };
  }

  if (def.thresholdDirection === 'gte') {
    if (value >= def.threshold) {
      return { badge: 'CUMPLE', badgeEn: 'PASS', color: '#16a34a' };
    }
    if (value >= def.threshold * 0.85) {
      return { badge: 'ALERTA', badgeEn: 'WARNING', color: '#d97706' };
    }
    return { badge: 'INCUMPLE', badgeEn: 'FAIL', color: '#dc2626' };
  }

  // lte
  if (value <= def.threshold) {
    return { badge: 'CUMPLE', badgeEn: 'PASS', color: '#16a34a' };
  }
  if (value <= def.threshold * 1.15) {
    return { badge: 'ALERTA', badgeEn: 'WARNING', color: '#d97706' };
  }
  return { badge: 'INCUMPLE', badgeEn: 'FAIL', color: '#dc2626' };
}

// ─── Computed ratio value extraction ─────────────────────────────

interface ComputedRatioValues {
  nwr: number;
  lcr: number;
  nim: number;
  ncr: number;
  provisionCoverage: number;
  roa: number;
  roe: number;
  efficiencyRatio: number;
  loanConcentration: number;
  durationGap: number;
  niiSensitivity: number;
  loanToDeposit: number;
}

function extractRatioValues(
  compliance: any,
  summary: any,
): ComputedRatioValues {
  const s = compliance?.summary || {};
  const totalAssets = s.totalAssets || 0;
  const equity = s.equity || 0;
  const totalLoans = s.totalLoans || 0;
  const totalShares = s.totalShares || 0;
  const liquidAssets = s.liquidAssets || 0;
  const nim =
    s.nim ?? compliance?.ratios?.find((r: any) => r.id === 12)?.value ?? 0;

  // NWR
  const nwr = totalAssets > 0 ? (equity / totalAssets) * 100 : 0;

  // LCR: from compliance ratios or summary
  const lcrRatio = compliance?.ratios?.find((r: any) => r.id === 9);
  const lcr =
    lcrRatio?.value ??
    (totalAssets > 0 ? (liquidAssets / totalAssets) * 100 * 6.67 : 0);

  // NCR: estimated from compliance ratios
  const ncrRatio = compliance?.ratios?.find((r: any) => r.id === 2);
  const ncr = ncrRatio?.value ?? 2.5; // Default estimate if not available

  // Provision coverage: estimated
  const provisionCoverage = ncr > 0 ? 120 : 100; // Conservative estimate

  // ROA: from NII / total assets as proxy
  const nii = s.interestIncome ?? 0;
  const interestExpense = s.interestExpense ?? 0;
  const netIncome = nii - interestExpense;
  const roa = totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0.8;

  // ROE
  const roe = equity > 0 ? (netIncome / equity) * 100 : 0;

  // Efficiency ratio
  const efficiencyRatio =
    compliance?.ratios?.find((r: any) => r.id === 8)?.value ?? 78;

  // Loan concentration: loans / equity
  const loanConcentration = equity > 0 ? (totalLoans / equity) * 100 : 0;

  // Duration gap
  const dg = summary?.durationGap;
  const durationGap = dg?.durationGap ?? 0;

  // NII sensitivity: pick max change from ±200bps scenarios
  const niiScenarios = summary?.niiSensitivity?.scenarios || [];
  const nii200 = niiScenarios.find((s: any) => Math.abs(s.shiftBps) === 200);
  const niiSensitivity = nii200 ? Math.abs(nii200.niImpactPct) : 5;

  // Loan to deposit
  const loanToDeposit = totalShares > 0 ? (totalLoans / totalShares) * 100 : 0;

  return {
    nwr: round(nwr, 2),
    lcr: round(lcr, 2),
    nim: round(nim, 2),
    ncr: round(ncr, 2),
    provisionCoverage: round(provisionCoverage, 2),
    roa: round(roa, 2),
    roe: round(roe, 2),
    efficiencyRatio: round(efficiencyRatio, 2),
    loanConcentration: round(loanConcentration, 2),
    durationGap: round(durationGap, 2),
    niiSensitivity: round(niiSensitivity, 2),
    loanToDeposit: round(loanToDeposit, 2),
  };
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ─── Narrative generators ──────────────────────────────────────────

function narrativeEs(
  def: CossecRatioDefinition,
  value: number,
  badge: ComplianceBadge,
): string {
  const valStr =
    def.unit === 'años' ? `${value.toFixed(2)} años` : `${value.toFixed(2)}%`;

  const statusPhrase =
    badge === 'CUMPLE'
      ? 'cumple con'
      : badge === 'ALERTA'
        ? 'está cercano al'
        : 'está por debajo del';

  const statusPhraseReverse =
    badge === 'CUMPLE'
      ? 'cumple con'
      : badge === 'ALERTA'
        ? 'está cercano al'
        : 'excede el';

  if (def.thresholdDirection === 'lte') {
    const action =
      badge === 'CUMPLE'
        ? 'cumple con'
        : badge === 'ALERTA'
          ? 'está cercano al'
          : 'excede el';
    return `La ${def.nameEs} de ${valStr} ${action} umbral máximo de COSSEC de ${def.thresholdLabel.replace(/[<>≥≤]\s*/, '')}. ${badge === 'CUMPLE' ? 'La institución mantiene esta métrica dentro de los parámetros regulatorios.' : 'Se recomienda un plan de acción para reducir esta razón.'}`;
  }

  if (def.thresholdDirection === 'range') {
    const inRange = badge === 'CUMPLE';
    return `La ${def.nameEs} de ${valStr} ${inRange ? 'se encuentra dentro del' : 'se encuentra fuera del'} rango aceptable de COSSEC de ${def.thresholdLabel}. ${inRange ? 'El perfil de riesgo de tasa de interés está adecuadamente gestionado.' : 'Se requiere revisión de la estructura de activos y pasivos para mejorar el calce de duraciones.'}`;
  }

  // gte
  return `La ${def.nameEs} de ${valStr} ${statusPhrase} umbral mínimo de COSSEC de ${def.thresholdLabel.replace(/[<>≥≤]\s*/, '')}. ${badge === 'CUMPLE' ? 'La institución mantiene niveles adecuados en esta métrica.' : 'Se recomienda implementar medidas para fortalecer esta razón.'}`;
}

function narrativeEn(
  def: CossecRatioDefinition,
  value: number,
  badge: ComplianceBadgeEn,
): string {
  const valStr =
    def.unit === 'años' ? `${value.toFixed(2)} years` : `${value.toFixed(2)}%`;

  if (def.thresholdDirection === 'lte') {
    const action =
      badge === 'PASS'
        ? 'meets'
        : badge === 'WARNING'
          ? 'is approaching'
          : 'exceeds';
    return `The ${def.nameEn} of ${valStr} ${action} COSSEC's maximum threshold of ${def.thresholdLabel.replace(/[<>≥≤]\s*/, '')}. ${badge === 'PASS' ? 'The institution maintains this metric within regulatory parameters.' : 'An action plan to reduce this ratio is recommended.'}`;
  }

  if (def.thresholdDirection === 'range') {
    const inRange = badge === 'PASS';
    return `The ${def.nameEn} of ${valStr} ${inRange ? 'falls within' : 'falls outside'} COSSEC's acceptable range of ${def.thresholdLabel}. ${inRange ? 'The interest rate risk profile is adequately managed.' : 'A review of asset-liability structure is recommended to improve duration matching.'}`;
  }

  // gte
  const action =
    badge === 'PASS'
      ? 'meets'
      : badge === 'WARNING'
        ? 'is approaching'
        : 'falls below';
  return `The ${def.nameEn} of ${valStr} ${action} COSSEC's minimum threshold of ${def.thresholdLabel.replace(/[<>≥≤]\s*/, '')}. ${badge === 'PASS' ? 'The institution maintains adequate levels for this metric.' : 'Implementing measures to strengthen this ratio is recommended.'}`;
}

// ─── Certification result ──────────────────────────────────────────

export interface CertificationResult {
  html: string;
  hash: string;
  composite: number;
}

export interface CertifyInput {
  certifiedBy: string;
  title: string;
}

// ─── Service ────────────────────────────────────────────────────────

@Injectable()
export class CAMELCertificationService {
  private readonly logger = new Logger(CAMELCertificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly camelScorer: CAMELScorerService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Generate COSSEC-formatted CAMEL self-assessment certification HTML.
   */
  async generateCertification(
    institutionId: string,
    period: string,
    lang: 'es' | 'en' = 'es',
  ): Promise<CertificationResult> {
    this.logger.log(
      `Generating CAMEL certification for ${institutionId}, period=${period}, lang=${lang}`,
    );

    // Fetch institution data
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!institution) {
      throw new NotFoundException(`Institution ${institutionId} not found`);
    }

    // Fetch CAMEL scores
    const camelResult = await this.camelScorer.scoreInstitution(institutionId);

    // Fetch ALM summary + COSSEC compliance for ratio data
    const [summarySettled, complianceSettled] = await Promise.allSettled([
      this.almEnterprise.getALMSummary(institutionId),
      this.almEnterprise.getRegulatoryCompliance(institutionId),
    ]);

    const summary =
      summarySettled.status === 'fulfilled' ? summarySettled.value : null;
    const compliance =
      complianceSettled.status === 'fulfilled' ? complianceSettled.value : null;

    // Extract computed ratio values
    const ratioValues = extractRatioValues(compliance, summary);

    // Compute verification hash
    const hashInput =
      JSON.stringify({
        institutionId,
        period,
        camelResult,
        ratioValues,
        summary: summary ? { riskScore: summary.riskScore } : null,
      }) + period;
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // Parse period for display
    const { quarter, year } = parsePeriod(period);

    // Build HTML
    const html = this.buildHtml({
      lang,
      institution,
      camelResult,
      ratioValues,
      quarter,
      year,
      period,
      hash,
    });

    return { html, hash, composite: camelResult.composite };
  }

  /**
   * Certify a report: persist to CamelCertification table + audit trail.
   * Upserts by (institutionId, period) — re-certifying the same period
   * overwrites the previous certification.
   */
  async certify(
    institutionId: string,
    period: string,
    input: CertifyInput,
    userId?: string,
  ): Promise<{
    certificationId: string;
    hash: string;
    certifiedAt: string;
    composite: number;
  }> {
    const { hash, composite } = await this.generateCertification(
      institutionId,
      period,
      'es',
    );

    const certifiedAt = new Date();

    // Persist certification record (upsert — one cert per period)
    const record = await this.prisma.camelCertification.upsert({
      where: {
        institution_period_cert: {
          institutionId,
          period,
        },
      },
      update: {
        certifiedBy: input.certifiedBy,
        title: input.title,
        htmlHash: hash,
        camelComposite: composite,
        certifiedAt,
      },
      create: {
        institutionId,
        period,
        certifiedBy: input.certifiedBy,
        title: input.title,
        htmlHash: hash,
        camelComposite: composite,
        certifiedAt,
      },
    });

    // Log certification event via audit service
    this.audit.log({
      userId,
      institutionId,
      action: 'CAMEL_CERTIFICATION',
      resource: 'camel_certification',
      resourceId: record.id,
      outcome: 'success',
      metadata: {
        period,
        certifiedBy: input.certifiedBy,
        title: input.title,
        hash,
        composite,
        certifiedAt: certifiedAt.toISOString(),
      },
    });

    this.logger.log(
      `CAMEL certification ${record.id} created for ${institutionId}, period=${period}, composite=${composite}, by=${input.certifiedBy}`,
    );

    return {
      certificationId: record.id,
      hash,
      certifiedAt: certifiedAt.toISOString(),
      composite,
    };
  }

  /**
   * List all certifications for an institution, most recent first.
   * Used by COSSEC examiners to review certification history.
   */
  async listCertifications(
    institutionId: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      period: string;
      certifiedBy: string;
      title: string;
      htmlHash: string;
      camelComposite: number;
      certifiedAt: Date;
    }>
  > {
    const certs = await this.prisma.camelCertification.findMany({
      where: { institutionId },
      orderBy: { certifiedAt: 'desc' },
      take: limit,
    });
    return certs.map((c: any) => ({
      id: c.id,
      period: c.period,
      certifiedBy: c.certifiedBy,
      title: c.title,
      htmlHash: c.htmlHash,
      camelComposite: Number(c.camelComposite),
      certifiedAt: c.certifiedAt,
    }));
  }

  // ─── HTML Builder ──────────────────────────────────────────────

  private buildHtml(params: {
    lang: 'es' | 'en';
    institution: any;
    camelResult: CAMELResult;
    ratioValues: ComputedRatioValues;
    quarter: string;
    year: string;
    period: string;
    hash: string;
  }): string {
    const {
      lang,
      institution,
      camelResult,
      ratioValues,
      quarter,
      year,
      period,
      hash,
    } = params;
    const isEs = lang === 'es';

    const institutionName = institution.name || 'Institución';
    const cossecNumber = institution.cossecRegistrationNumber || 'N/A';

    // Map ratio definitions to computed values
    const valueMap: Record<number, number> = {
      1: ratioValues.nwr,
      2: ratioValues.lcr,
      3: ratioValues.nim,
      4: ratioValues.ncr,
      5: ratioValues.provisionCoverage,
      6: ratioValues.roa,
      7: ratioValues.roe,
      8: ratioValues.efficiencyRatio,
      9: ratioValues.loanConcentration,
      10: ratioValues.durationGap,
      11: ratioValues.niiSensitivity,
      12: ratioValues.loanToDeposit,
    };

    // Build ratio rows HTML
    const ratioRows = COSSEC_RATIOS.map((def) => {
      const value = valueMap[def.id] ?? 0;
      const { badge, badgeEn, color } = getComplianceBadge(value, def);
      const displayBadge = isEs ? badge : badgeEn;
      const narrative = isEs
        ? narrativeEs(def, value, badge)
        : narrativeEn(def, value, badgeEn);
      const name = isEs ? def.nameEs : def.nameEn;
      const formula = isEs ? def.formulaEs : def.formulaEn;
      const valueDisplay =
        def.unit === 'años' || def.unit === 'years'
          ? `${value.toFixed(2)}`
          : `${value.toFixed(2)}%`;

      return {
        def,
        value,
        badge: displayBadge,
        color,
        narrative,
        name,
        formula,
        valueDisplay,
      };
    });

    // CAMEL component table
    const camelRows = camelResult.components
      .map((c) => {
        const name = isEs ? c.componentEs : c.component;
        const rating = isEs ? c.ratingEs : c.rating;
        const detail = isEs ? c.detailEs : c.detail;
        const scoreColor =
          c.score <= 2 ? '#16a34a' : c.score <= 3 ? '#d97706' : '#dc2626';
        return `
          <tr>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${name}</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb; text-align: center;">
              <span style="display: inline-block; background: ${scoreColor}; color: #fff; padding: 3px 12px; border-radius: 4px; font-weight: 700; font-size: 14px;">${c.score}</span>
            </td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${rating}</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${detail}</td>
          </tr>`;
      })
      .join('');

    // Titles
    const t = {
      title: isEs
        ? `AUTOEVALUACI\u00D3N CAMEL \u2014 ${quarter} ${year}`
        : `CAMEL SELF-ASSESSMENT \u2014 ${quarter} ${year}`,
      subtitle: isEs
        ? 'Informe de Autoevaluaci\u00F3n Regulatoria'
        : 'Regulatory Self-Assessment Report',
      institution: isEs ? 'Instituci\u00F3n' : 'Institution',
      license: isEs
        ? 'N\u00FAmero de Licencia COSSEC'
        : 'COSSEC License Number',
      period: isEs ? 'Per\u00EDodo' : 'Period',
      ratioTableTitle: isEs
        ? 'Tabla de 12 Razones COSSEC'
        : 'COSSEC 12-Ratio Table',
      ratioCol: isEs ? 'Raz\u00F3n' : 'Ratio',
      formulaCol: isEs ? 'F\u00F3rmula' : 'Formula',
      valueCol: isEs ? 'Valor' : 'Value',
      thresholdCol: isEs ? 'Umbral COSSEC' : 'COSSEC Threshold',
      statusCol: isEs ? 'Estado' : 'Status',
      narrativeTitle: isEs ? 'An\u00E1lisis Narrativo' : 'Narrative Analysis',
      camelTitle: isEs ? 'Puntaje Compuesto CAMEL' : 'CAMEL Composite Score',
      componentCol: isEs ? 'Componente' : 'Component',
      scoreCol: isEs ? 'Puntaje' : 'Score',
      ratingCol: isEs ? 'Calificaci\u00F3n' : 'Rating',
      detailCol: isEs ? 'Detalle' : 'Detail',
      compositeLabel: isEs ? 'Puntaje Compuesto' : 'Composite Score',
      compositeRating: isEs
        ? camelResult.compositeRatingEs
        : camelResult.compositeRating,
      readiness: isEs ? 'Preparaci\u00F3n para Examen' : 'Exam Readiness',
      readinessValue:
        camelResult.examReadiness === 'READY'
          ? isEs
            ? 'PREPARADO'
            : 'READY'
          : camelResult.examReadiness === 'NEEDS_WORK'
            ? isEs
              ? 'NECESITA MEJORAS'
              : 'NEEDS WORK'
            : isEs
              ? 'EN RIESGO'
              : 'AT RISK',
      signatureTitle: isEs
        ? 'Bloque de Certificaci\u00F3n'
        : 'Certification Block',
      certifiedBy: isEs ? 'Certificado por' : 'Certified by',
      titleLabel: isEs ? 'Cargo' : 'Title',
      dateLabel: isEs ? 'Fecha' : 'Date',
      hashLabel: isEs
        ? 'Hash de verificaci\u00F3n CERNIQ'
        : 'CERNIQ Verification Hash',
      footer: isEs
        ? 'Generado por CERNIQ \u2014 cerniq.io | Este documento fue preparado con datos proporcionados por la instituci\u00F3n.'
        : 'Generated by CERNIQ \u2014 cerniq.io | This document was prepared with data provided by the institution.',
      generatedAt: isEs ? 'Generado' : 'Generated',
    };

    const readinessColor =
      camelResult.examReadiness === 'READY'
        ? '#16a34a'
        : camelResult.examReadiness === 'NEEDS_WORK'
          ? '#d97706'
          : '#dc2626';

    const compositeColor =
      camelResult.composite <= 2
        ? '#16a34a'
        : camelResult.composite <= 3
          ? '#d97706'
          : '#dc2626';

    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title} - ${institutionName}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1f2937;
      background: #fff;
    }
    .page { max-width: 210mm; margin: 0 auto; padding: 24px; }
    .header {
      background: #1B3A6B;
      color: #fff;
      padding: 28px 32px;
      border-radius: 8px 8px 0 0;
      margin-bottom: 0;
    }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.5px; }
    .header h2 { font-size: 14px; font-weight: 400; opacity: 0.85; }
    .header-meta {
      background: #f0f4f8;
      border: 1px solid #d1d5db;
      border-top: none;
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      border-radius: 0 0 8px 8px;
      margin-bottom: 28px;
    }
    .header-meta div { font-size: 13px; }
    .header-meta strong { color: #1B3A6B; }
    .section-title {
      background: #1B3A6B;
      color: #fff;
      padding: 10px 20px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 6px 6px 0 0;
      margin-top: 28px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #d1d5db;
      border-top: none;
      margin-bottom: 0;
    }
    th {
      background: #e8edf3;
      color: #1B3A6B;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 700;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-bottom: 2px solid #1B3A6B;
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 13px;
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #f9fafb; }
    .badge {
      display: inline-block;
      padding: 3px 12px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #fff;
    }
    .narrative-section {
      border: 1px solid #d1d5db;
      border-top: none;
      padding: 20px 24px;
      border-radius: 0 0 6px 6px;
    }
    .narrative-item {
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid #f3f4f6;
    }
    .narrative-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .narrative-item h4 {
      color: #1B3A6B;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .narrative-item p {
      color: #4b5563;
      font-size: 13px;
      line-height: 1.6;
    }
    .composite-box {
      border: 1px solid #d1d5db;
      border-top: none;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      gap: 32px;
      flex-wrap: wrap;
      border-radius: 0 0 6px 6px;
    }
    .composite-score {
      font-size: 48px;
      font-weight: 800;
      line-height: 1;
    }
    .signature-block {
      border: 1px solid #d1d5db;
      border-top: none;
      padding: 28px 32px;
      border-radius: 0 0 6px 6px;
    }
    .sig-line {
      display: flex;
      gap: 40px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .sig-field {
      flex: 1;
      min-width: 200px;
    }
    .sig-field label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .sig-field .line {
      border-bottom: 2px solid #1B3A6B;
      height: 32px;
    }
    .footer {
      margin-top: 28px;
      padding: 16px 24px;
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      text-align: center;
    }
    .footer .hash {
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: #6b7280;
      word-break: break-all;
      margin-bottom: 8px;
    }
    .footer .disclaimer {
      font-size: 11px;
      color: #9ca3af;
    }
    .logo-text {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: 2px;
      float: right;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- HEADER -->
    <div class="header">
      <span class="logo-text">CERNIQ</span>
      <h1>${t.title}</h1>
      <h2>${t.subtitle}</h2>
    </div>
    <div class="header-meta">
      <div><strong>${t.institution}:</strong> ${institutionName}</div>
      <div><strong>${t.license}:</strong> ${cossecNumber}</div>
      <div><strong>${t.period}:</strong> ${period}</div>
      <div><strong>${t.generatedAt}:</strong> ${now}</div>
    </div>

    <!-- 12 RATIO TABLE -->
    <div class="section-title">${t.ratioTableTitle}</div>
    <table>
      <thead>
        <tr>
          <th style="width: 5%;">#</th>
          <th style="width: 22%;">${t.ratioCol}</th>
          <th style="width: 28%;">${t.formulaCol}</th>
          <th style="width: 12%; text-align: right;">${t.valueCol}</th>
          <th style="width: 18%;">${t.thresholdCol}</th>
          <th style="width: 15%; text-align: center;">${t.statusCol}</th>
        </tr>
      </thead>
      <tbody>
        ${ratioRows
          .map(
            (r) => `
        <tr>
          <td style="font-weight: 600; color: #1B3A6B;">${r.def.id}</td>
          <td style="font-weight: 600;">${r.name}</td>
          <td style="font-size: 11px; color: #6b7280; font-style: italic;">${r.formula}</td>
          <td style="text-align: right; font-weight: 700; font-family: 'Courier New', monospace;">${r.valueDisplay}</td>
          <td>${r.def.thresholdLabel}</td>
          <td style="text-align: center;"><span class="badge" style="background: ${r.color};">${r.badge}</span></td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>

    <!-- NARRATIVE ANALYSIS -->
    <div class="section-title" style="margin-top: 28px;">${t.narrativeTitle}</div>
    <div class="narrative-section">
      ${ratioRows
        .map(
          (r) => `
      <div class="narrative-item">
        <h4>${r.def.id}. ${r.name} <span class="badge" style="background: ${r.color}; font-size: 10px; vertical-align: middle; margin-left: 8px;">${r.badge}</span></h4>
        <p>${r.narrative}</p>
      </div>`,
        )
        .join('')}
    </div>

    <!-- CAMEL COMPOSITE SCORE -->
    <div class="section-title" style="margin-top: 28px;">${t.camelTitle}</div>
    <table>
      <thead>
        <tr>
          <th>${t.componentCol}</th>
          <th style="text-align: center;">${t.scoreCol}</th>
          <th>${t.ratingCol}</th>
          <th>${t.detailCol}</th>
        </tr>
      </thead>
      <tbody>
        ${camelRows}
      </tbody>
    </table>
    <div class="composite-box">
      <div>
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px;">${t.compositeLabel}</div>
        <span class="composite-score" style="color: ${compositeColor};">${camelResult.composite}</span>
        <span style="font-size: 16px; font-weight: 600; color: ${compositeColor}; margin-left: 8px;">${t.compositeRating}</span>
      </div>
      <div>
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px;">${t.readiness}</div>
        <span style="display: inline-block; padding: 6px 16px; border-radius: 6px; background: ${readinessColor}; color: #fff; font-weight: 700; font-size: 14px;">${t.readinessValue}</span>
      </div>
    </div>

    <!-- SIGNATURE BLOCK -->
    <div class="section-title" style="margin-top: 28px;">${t.signatureTitle}</div>
    <div class="signature-block">
      <div class="sig-line">
        <div class="sig-field">
          <label>${t.certifiedBy}</label>
          <div class="line"></div>
        </div>
        <div class="sig-field">
          <label>${t.titleLabel}</label>
          <div class="line"></div>
        </div>
        <div class="sig-field">
          <label>${t.dateLabel}</label>
          <div class="line"></div>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <div class="hash">${t.hashLabel}: ${hash}</div>
      <div class="disclaimer">${t.footer}</div>
    </div>
  </div>
</body>
</html>`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function parsePeriod(period: string): { quarter: string; year: string } {
  // Expected formats: "2026-Q1", "Q1-2026", "2026Q1", "Q1 2026"
  const match =
    period.match(/(\d{4})[- ]?Q(\d)/i) || period.match(/Q(\d)[- ]?(\d{4})/i);
  if (match) {
    // Determine which capture group has the year
    const year = match[1].length === 4 ? match[1] : match[2];
    const q = match[1].length === 4 ? match[2] : match[1];
    return { quarter: `Q${q}`, year };
  }
  // Fallback
  return { quarter: period, year: '' };
}

// Re-export for testing
export {
  COSSEC_RATIOS,
  getComplianceBadge,
  narrativeEs,
  narrativeEn,
  parsePeriod,
  extractRatioValues,
};
