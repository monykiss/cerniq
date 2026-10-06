import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CAMELScorerService, CAMELResult } from './camel-scorer.service';

// ─── 24-Item Governance Checklist ────────────────────────────

const GOVERNANCE_ITEMS = [
  {
    id: 'board_meetings',
    item: 'Board meets at least 10 times/year',
    itemEs: 'Junta se reúne al menos 10 veces/año',
    category: 'governance',
  },
  {
    id: 'risk_committee',
    item: 'Risk Management Committee meets quarterly',
    itemEs: 'Comité de Riesgo se reúne trimestralmente',
    category: 'governance',
  },
  {
    id: 'alm_committee',
    item: 'ALM/IRRC Committee meets quarterly',
    itemEs: 'Comité ALM/IRRC se reúne trimestralmente',
    category: 'governance',
  },
  {
    id: 'irr_policy',
    item: 'IRR Policy reviewed by board in last 12 months',
    itemEs: 'Política IRR revisada por junta en últimos 12 meses',
    category: 'policy',
  },
  {
    id: 'investment_policy',
    item: 'Investment Policy reviewed in last 12 months',
    itemEs: 'Política de Inversiones revisada en últimos 12 meses',
    category: 'policy',
  },
  {
    id: 'loan_policy',
    item: 'Loan Policy reviewed in last 12 months',
    itemEs: 'Política de Préstamos revisada en últimos 12 meses',
    category: 'policy',
  },
  {
    id: 'bsa_policy',
    item: 'BSA/AML Policy reviewed in last 12 months',
    itemEs: 'Política BSA/AML revisada en últimos 12 meses',
    category: 'compliance',
  },
  {
    id: 'alm_audit',
    item: 'Independent ALM audit performed in last 12 months',
    itemEs: 'Auditoría ALM independiente realizada en últimos 12 meses',
    category: 'audit',
  },
  {
    id: 'stress_board',
    item: 'Stress test results presented to board',
    itemEs: 'Resultados de estrés presentados a junta',
    category: 'risk',
  },
  {
    id: 'cecl_doc',
    item: 'CECL methodology documented and board-approved',
    itemEs: 'Metodología CECL documentada y aprobada por junta',
    category: 'credit',
  },
  {
    id: 'cfp',
    item: 'Liquidity Contingency Funding Plan exists',
    itemEs: 'Plan de Contingencia de Liquidez existe',
    category: 'liquidity',
  },
  {
    id: 'deposit_limits',
    item: 'Deposit concentration limits established',
    itemEs: 'Límites de concentración de depósitos establecidos',
    category: 'risk',
  },
  {
    id: 'lts_limit',
    item: 'Loan-to-share limit established',
    itemEs: 'Límite préstamos/acciones establecido',
    category: 'policy',
  },
  {
    id: 'capital_plan',
    item: 'Capital restoration plan triggers documented',
    itemEs: 'Disparadores del plan de restauración de capital documentados',
    category: 'capital',
  },
  {
    id: 'succession',
    item: 'CEO/CFO succession plan documented',
    itemEs: 'Plan de sucesión CEO/CFO documentado',
    category: 'governance',
  },
  {
    id: 'dr_test',
    item: 'IT Disaster Recovery plan tested in last 12 months',
    itemEs: 'Plan DR de TI probado en últimos 12 meses',
    category: 'it',
  },
  {
    id: 'cyber_plan',
    item: 'Cybersecurity incident response plan exists',
    itemEs: 'Plan de respuesta a incidentes cibernéticos existe',
    category: 'it',
  },
  {
    id: 'vendor_mgmt',
    item: 'Vendor management program documented',
    itemEs: 'Programa de gestión de proveedores documentado',
    category: 'operations',
  },
  {
    id: 'ofac',
    item: 'OFAC screening program operational',
    itemEs: 'Programa de verificación OFAC operacional',
    category: 'compliance',
  },
  {
    id: 'bsa_training',
    item: 'BSA training completed for all employees',
    itemEs: 'Capacitación BSA completada para todos los empleados',
    category: 'compliance',
  },
  {
    id: 'irr_training',
    item: 'IRR training for ALM staff completed',
    itemEs: 'Capacitación IRR para personal ALM completada',
    category: 'risk',
  },
  {
    id: 'board_training',
    item: 'Board fiduciary duties training completed',
    itemEs: 'Capacitación en deberes fiduciarios de junta completada',
    category: 'governance',
  },
  {
    id: 'external_audit',
    item: 'External audit performed in last 12 months',
    itemEs: 'Auditoría externa realizada en últimos 12 meses',
    category: 'audit',
  },
  {
    id: 'mgmt_letter',
    item: 'Auditor management letter reviewed by board',
    itemEs: 'Carta de gerencia del auditor revisada por junta',
    category: 'audit',
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface GovernanceCheckItem {
  id: string;
  item: string;
  itemEs: string;
  category: string;
  completed: boolean;
  notes?: string;
  evidenceUrl?: string;
}

export interface ExamPrepResult {
  camel: CAMELResult;
  governance: {
    items: GovernanceCheckItem[];
    completedCount: number;
    totalCount: number;
    completionPct: number;
    managementScore: number;
  };
  findings: Array<{
    id: string;
    finding: string;
    findingEs: string;
    targetDate: string;
    status: 'open' | 'in_progress' | 'closed';
  }>;
  scheduleStatus: Array<{
    schedule: string;
    name: string;
    nameEs: string;
    available: boolean;
    dataSource: string;
  }>;
}

@Injectable()
export class ExamPrepService {
  private readonly logger = new Logger(ExamPrepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly camelScorer: CAMELScorerService,
  ) {}

  async getExamPrep(institutionId: string): Promise<ExamPrepResult> {
    const camel = await this.camelScorer.scoreInstitution(institutionId);

    // Governance checklist — default all unchecked for new institutions
    const governance: GovernanceCheckItem[] = GOVERNANCE_ITEMS.map(
      (item, i) => ({
        ...item,
        completed: i < 18, // demo: 18/24 complete
      }),
    );
    const completedCount = governance.filter((g) => g.completed).length;
    const managementScore =
      completedCount >= 22
        ? 1
        : completedCount >= 18
          ? 2
          : completedCount >= 14
            ? 3
            : completedCount >= 10
              ? 4
              : 5;

    // Sample prior findings
    const findings = [
      {
        id: 'f1',
        finding:
          'Concentration limit for CRE not formally documented in board-approved policy',
        findingEs:
          'Límite de concentración para CRE no documentado formalmente en política aprobada por junta',
        targetDate: '2026-06-30',
        status: 'in_progress' as const,
      },
      {
        id: 'f2',
        finding: 'BSA training records incomplete for 3 employees',
        findingEs: 'Registros de capacitación BSA incompletos para 3 empleados',
        targetDate: '2026-04-15',
        status: 'open' as const,
      },
      {
        id: 'f3',
        finding:
          'Interest rate risk model validation not performed within required 3-year cycle',
        findingEs:
          'Validación del modelo de riesgo de tasa no realizada dentro del ciclo requerido de 3 años',
        targetDate: '2026-03-31',
        status: 'closed' as const,
      },
    ];

    // Schedule availability
    const scheduleStatus = [
      {
        schedule: '1',
        name: 'Institution Profile & Capital',
        nameEs: 'Perfil Institucional y Capital',
        available: true,
        dataSource: 'Institution model',
      },
      {
        schedule: '2',
        name: 'Balance Sheet (Assets)',
        nameEs: 'Balance General (Activos)',
        available: true,
        dataSource: 'BalanceSheetItem',
      },
      {
        schedule: '3',
        name: 'Balance Sheet (Liabilities)',
        nameEs: 'Balance General (Pasivos)',
        available: true,
        dataSource: 'BalanceSheetItem',
      },
      {
        schedule: '4',
        name: 'Income Statement',
        nameEs: 'Estado de Resultados',
        available: true,
        dataSource: 'ALM Summary (NII)',
      },
      {
        schedule: '5',
        name: 'Loan Portfolio Analysis',
        nameEs: 'Análisis Cartera Préstamos',
        available: true,
        dataSource: 'LoanSegment',
      },
      {
        schedule: '6',
        name: 'Investment Portfolio',
        nameEs: 'Cartera de Inversiones',
        available: true,
        dataSource: 'BalanceSheetItem + OAS',
      },
      {
        schedule: '7',
        name: 'Repricing Gap Report',
        nameEs: 'Informe Brecha Repricing',
        available: true,
        dataSource: 'RepricingGapService',
      },
      {
        schedule: '8',
        name: 'Interest Rate Risk',
        nameEs: 'Riesgo de Tasa de Interés',
        available: true,
        dataSource: 'YieldCurve + EVE/NII',
      },
      {
        schedule: '9',
        name: 'Liquidity Analysis',
        nameEs: 'Análisis de Liquidez',
        available: true,
        dataSource: 'LCR/NSFR + Stress Pack',
      },
      {
        schedule: '10',
        name: 'Capital Adequacy',
        nameEs: 'Suficiencia de Capital',
        available: true,
        dataSource: 'CapitalOptimizer',
      },
      {
        schedule: '11',
        name: 'CECL Allowance',
        nameEs: 'Provisión CECL',
        available: true,
        dataSource: 'CECL Service',
      },
      {
        schedule: '12',
        name: 'Concentration Risk',
        nameEs: 'Riesgo de Concentración',
        available: true,
        dataSource: 'ConcentrationService',
      },
    ];

    return {
      camel,
      governance: {
        items: governance,
        completedCount,
        totalCount: GOVERNANCE_ITEMS.length,
        completionPct: Math.round(
          (completedCount / GOVERNANCE_ITEMS.length) * 100,
        ),
        managementScore,
      },
      findings,
      scheduleStatus,
    };
  }
}
