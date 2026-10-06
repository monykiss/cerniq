/**
 * Pre-Exam Chain — Fixture Data
 *
 * Vol.1 Bible Pattern 2: Pre-Examination Preparation
 * REGULATORY_COMPLIANCE -> EXAM_PREP -> (if grade < C) -> CAPITAL_OPTIMIZER
 *
 * This fixture tests two paths:
 *   1. Happy path: EXAM_PREP produces grade B -> chain stops (no remediation needed)
 *   2. Remediation path: EXAM_PREP produces grade D -> continues to CAPITAL_OPTIMIZER
 */

import type {
  ChainConfig,
  ChainStepFixture,
} from '../cross-agent-regression.harness';

// ─── Shared: Regulatory Compliance Output ───────────────────────────────────

const REGULATORY_COMPLIANCE_OUTPUT = {
  agentId: 'regulatory_compliance',
  version: '1.0',
  runId: 'run_rc_exam_001',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T08:00:00.000Z',
  language: 'bilingual',
  dashboard: {
    red: [
      {
        deadlineId: 'dl_cossec_q2_2026',
        category: 'FILING',
        description: 'COSSEC Quarterly Financial Statement',
        descriptionEs: 'Estado Financiero Trimestral COSSEC',
        regulatoryBody: 'COSSEC',
        regulationRef: 'COSSEC Reg. 8866 Art. 42',
        dueDate: '2026-04-30T23:59:59.000Z',
        daysUntilDue: 15,
        rag: 'RED',
        preparationSteps: [
          'Reconcile GL accounts',
          'Verify CECL calculations',
          'Board approval',
        ],
        status: 'IN_PREPARATION',
      },
    ],
    amber: [
      {
        deadlineId: 'dl_ncua_5300_q2',
        category: 'FILING',
        description: 'NCUA 5300 Call Report',
        descriptionEs: 'Reporte de Llamada NCUA 5300',
        regulatoryBody: 'NCUA',
        regulationRef: 'NCUA Part 741.6',
        dueDate: '2026-07-31T23:59:59.000Z',
        daysUntilDue: 107,
        rag: 'AMBER',
        status: 'NOT_STARTED',
      },
    ],
    green: [
      {
        deadlineId: 'dl_bsa_training',
        category: 'TRAINING',
        description: 'BSA/AML Annual Staff Training',
        descriptionEs: 'Capacitacion Anual BSA/AML del Personal',
        regulatoryBody: 'FinCEN',
        regulationRef: 'FinCEN 31 CFR 1020.210',
        dueDate: '2026-12-31T23:59:59.000Z',
        daysUntilDue: 260,
        rag: 'GREEN',
        status: 'COMPLETE',
      },
    ],
  },
  summary:
    'COSSEC Q2 filing due in 15 days requires immediate attention. NCUA 5300 on track for July deadline.',
  summaryEs:
    'El reporte COSSEC Q2 vence en 15 dias y requiere atencion inmediata. NCUA 5300 en camino para julio.',
  auditTraceId: 'trace_rc_exam_001',
};

// ─── Happy Path: Exam Prep Grade B (chain stops) ───────────────────────────

const EXAM_PREP_GRADE_B_OUTPUT = {
  agentId: 'exam_prep',
  version: '1.0',
  runId: 'run_ep_exam_001',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T08:05:00.000Z',
  language: 'bilingual',
  overallGrade: 'B',
  camelAssessment: {
    composite: 2,
    components: [
      {
        component: 'CAPITAL',
        score: 2,
        finding: 'Net worth 7.4% — adequate but declining.',
        findingEs: 'Patrimonio neto 7.4% — adecuado pero en declive.',
        remediation:
          'Monitor quarterly, stress-test capital under adverse scenarios.',
        remediationEs:
          'Monitorear trimestralmente, someter a estres capital bajo escenarios adversos.',
      },
      {
        component: 'ASSET_QUALITY',
        score: 2,
        finding: 'Delinquency 2.1%, CECL coverage 1.42%.',
        findingEs: 'Morosidad 2.1%, cobertura CECL 1.42%.',
        remediation: 'Increase CECL reserve for CRE segment.',
        remediationEs: 'Aumentar reserva CECL para segmento CRE.',
      },
      {
        component: 'MANAGEMENT',
        score: 2,
        finding: 'Board oversight satisfactory, policy manual current.',
        findingEs:
          'Supervision de junta satisfactoria, manual de politicas vigente.',
        remediation: 'Complete succession plan documentation.',
        remediationEs: 'Completar documentacion del plan de sucesion.',
      },
      {
        component: 'EARNINGS',
        score: 2,
        finding: 'ROA 0.62% — below peer but stable.',
        findingEs: 'ROA 0.62% — debajo de pares pero estable.',
        remediation: 'Focus on NIM improvement through loan repricing.',
        remediationEs:
          'Enfocarse en mejorar NIM a traves de repricing de prestamos.',
      },
      {
        component: 'LIQUIDITY',
        score: 3,
        finding: 'LCR 112%, declining trend. Below peer median.',
        findingEs: 'LCR 112%, tendencia a la baja. Debajo de mediana de pares.',
        remediation:
          'Increase HQLA allocation. Establish contingency funding plan.',
        remediationEs:
          'Aumentar asignacion HQLA. Establecer plan de financiamiento de contingencia.',
      },
    ],
  },
  governanceChecklist: {
    total: 24,
    passed: 20,
    items: [
      { item: 'Board minutes current', status: 'PASS' },
      { item: 'ALM policy reviewed annually', status: 'PASS' },
      { item: 'Succession plan documented', status: 'PARTIAL' },
      { item: 'BSA/AML program current', status: 'PASS' },
    ],
  },
  redFlags: [],
  documentChecklist: [
    { document: 'Board Meeting Minutes (12 months)', status: 'READY' },
    { document: 'ALM Policy Manual', status: 'READY' },
    {
      document: 'Succession Plan',
      status: 'IN_PREPARATION',
      owner: 'HR Director',
      dueDate: '2026-05-15T00:00:00.000Z',
    },
  ],
  remediationPlan: [
    {
      priority: 1,
      item: 'Complete succession plan documentation',
      itemEs: 'Completar documentacion plan de sucesion',
      camelComponent: 'MANAGEMENT',
      estimatedImpactOnRating: 'Prevents downgrade to 3',
      deadline: '2026-05-15T00:00:00.000Z',
      owner: 'HR Director',
    },
  ],
  managementLetterDraft:
    'The cooperativa demonstrates satisfactory overall condition with a CAMEL composite of 2. Primary area requiring attention is liquidity management, with LCR trending below peer median.',
  managementLetterDraftEs:
    'La cooperativa demuestra una condicion general satisfactoria con un compuesto CAMEL de 2. El area principal que requiere atencion es la gestion de liquidez, con LCR por debajo de la mediana de pares.',
  auditTraceId: 'trace_ep_exam_001',
};

// ─── Remediation Path: Exam Prep Grade D (chain continues) ─────────────────

const EXAM_PREP_GRADE_D_OUTPUT = {
  agentId: 'exam_prep',
  version: '1.0',
  runId: 'run_ep_exam_002',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T08:05:00.000Z',
  language: 'bilingual',
  overallGrade: 'D',
  camelAssessment: {
    composite: 4,
    components: [
      {
        component: 'CAPITAL',
        score: 4,
        finding: 'Net worth 5.2% — below well-capitalized threshold.',
        findingEs:
          'Patrimonio neto 5.2% — por debajo del umbral de bien capitalizado.',
        remediation:
          'Immediate capital restoration plan required. Retain all earnings, suspend dividends.',
        remediationEs:
          'Plan de restauracion de capital inmediato requerido. Retener todas las ganancias, suspender dividendos.',
      },
      {
        component: 'ASSET_QUALITY',
        score: 4,
        finding: 'Delinquency 4.8%, charge-offs up 180%.',
        findingEs: 'Morosidad 4.8%, castigos aumentaron 180%.',
        remediation: 'Tighten underwriting, increase CECL reserve $1.2M.',
        remediationEs: 'Endurecer suscripcion, aumentar reserva CECL $1.2M.',
      },
      {
        component: 'MANAGEMENT',
        score: 3,
        finding: 'Board lacks risk management expertise.',
        findingEs: 'La junta carece de experiencia en gestion de riesgo.',
        remediation: 'Recruit board member with risk/finance background.',
        remediationEs:
          'Reclutar miembro de junta con experiencia en riesgo/finanzas.',
      },
      {
        component: 'EARNINGS',
        score: 4,
        finding: 'ROA -0.15%. Operating losses for 2 consecutive quarters.',
        findingEs:
          'ROA -0.15%. Perdidas operativas por 2 trimestres consecutivos.',
        remediation: 'Cost reduction program targeting 15% expense reduction.',
        remediationEs:
          'Programa de reduccion de costos apuntando a 15% de reduccion de gastos.',
      },
      {
        component: 'LIQUIDITY',
        score: 4,
        finding: 'LCR 85%. Emergency borrowing lines utilized.',
        findingEs: 'LCR 85%. Lineas de prestamo de emergencia utilizadas.',
        remediation:
          'Activate contingency funding plan. Negotiate additional FHLB lines.',
        remediationEs:
          'Activar plan de financiamiento de contingencia. Negociar lineas FHLB adicionales.',
      },
    ],
  },
  governanceChecklist: {
    total: 24,
    passed: 10,
    items: [
      { item: 'Board minutes current', status: 'PASS' },
      { item: 'ALM policy reviewed annually', status: 'FAIL' },
      { item: 'Capital restoration plan', status: 'FAIL' },
      { item: 'Contingency funding plan', status: 'FAIL' },
    ],
  },
  redFlags: [
    {
      issue:
        'Net worth below well-capitalized threshold for 2 consecutive quarters',
      issueEs:
        'Patrimonio neto por debajo del umbral de bien capitalizado por 2 trimestres consecutivos',
      likelyExaminerComment:
        'Prompt Corrective Action may be required under NCUA Part 702',
      preparedResponse:
        'Board has approved capital restoration plan with target to restore 7% net worth within 18 months.',
      preparedResponseEs:
        'La junta ha aprobado plan de restauracion de capital con meta de restaurar 7% patrimonio neto en 18 meses.',
    },
    {
      issue: 'Operating losses for 2 consecutive quarters',
      issueEs: 'Perdidas operativas por 2 trimestres consecutivos',
      likelyExaminerComment: 'Earnings trend raises going-concern questions',
      preparedResponse:
        'Management has implemented cost reduction program targeting 15% expense reduction. Q3 projections show return to profitability.',
      preparedResponseEs:
        'La gerencia ha implementado programa de reduccion de costos. Proyecciones Q3 muestran retorno a rentabilidad.',
    },
  ],
  documentChecklist: [
    { document: 'Capital Restoration Plan', status: 'MISSING' },
    { document: 'Contingency Funding Plan', status: 'MISSING' },
    { document: 'Board Meeting Minutes (12 months)', status: 'READY' },
  ],
  remediationPlan: [
    {
      priority: 1,
      item: 'Draft and approve capital restoration plan',
      itemEs: 'Redactar y aprobar plan de restauracion de capital',
      camelComponent: 'CAPITAL',
      estimatedImpactOnRating: 'Required for PCA compliance',
      deadline: '2026-05-01T00:00:00.000Z',
      owner: 'CFO',
    },
    {
      priority: 2,
      item: 'Activate contingency funding plan',
      itemEs: 'Activar plan de financiamiento de contingencia',
      camelComponent: 'LIQUIDITY',
      estimatedImpactOnRating: 'Could improve L from 4 to 3',
      deadline: '2026-04-30T00:00:00.000Z',
      owner: 'Treasurer',
    },
    {
      priority: 3,
      item: 'Increase CECL reserve by $1.2M',
      itemEs: 'Aumentar reserva CECL en $1.2M',
      camelComponent: 'ASSET_QUALITY',
      estimatedImpactOnRating: 'Could improve A from 4 to 3',
      deadline: '2026-05-15T00:00:00.000Z',
      owner: 'CFO',
    },
  ],
  managementLetterDraft:
    'The cooperativa demonstrates significant weaknesses requiring immediate corrective action. CAMEL composite of 4 reflects deteriorating capital, asset quality, and earnings. Prompt Corrective Action considerations apply.',
  managementLetterDraftEs:
    'La cooperativa demuestra debilidades significativas que requieren accion correctiva inmediata. Compuesto CAMEL de 4 refleja deterioro en capital, calidad de activos y ganancias.',
  auditTraceId: 'trace_ep_exam_002',
};

// ─── Capital Optimizer Output (for remediation path) ────────────────────────

const CAPITAL_OPTIMIZER_OUTPUT = {
  agentId: 'capital_optimizer',
  version: '1.0',
  runId: 'run_co_exam_001',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T08:10:00.000Z',
  language: 'bilingual',
  currentState: [
    {
      category: 'Fixed Rate Loans (5yr+)',
      balance: 85000000,
      yield: 5.25,
      duration: 4.2,
    },
    {
      category: 'Variable Rate Loans',
      balance: 45000000,
      yield: 6.1,
      duration: 0.8,
    },
    {
      category: 'Investment Securities',
      balance: 42000000,
      yield: 3.8,
      duration: 3.5,
    },
    {
      category: 'HQLA (T-bills/Cash)',
      balance: 18000000,
      yield: 4.5,
      duration: 0.3,
    },
  ],
  optimizedState: [
    {
      category: 'Fixed Rate Loans (5yr+)',
      balance: 70000000,
      yield: 5.25,
      duration: 4.2,
    },
    {
      category: 'Variable Rate Loans',
      balance: 60000000,
      yield: 6.1,
      duration: 0.8,
    },
    {
      category: 'Investment Securities',
      balance: 38000000,
      yield: 3.8,
      duration: 3.5,
    },
    {
      category: 'HQLA (T-bills/Cash)',
      balance: 22000000,
      yield: 4.5,
      duration: 0.3,
    },
  ],
  moves: [
    {
      source: 'Fixed Rate Loans (5yr+)',
      target: 'Variable Rate Loans',
      amount: 15000000,
      timeline: '60d',
      nimImpactBps: 12,
      nimImpactDollars: 840000,
      rationale:
        'Reduce duration gap and rate sensitivity. Variable rate loans reprice within 1yr.',
    },
    {
      source: 'Investment Securities',
      target: 'HQLA (T-bills/Cash)',
      amount: 4000000,
      timeline: '30d',
      nimImpactBps: -2,
      nimImpactDollars: -140000,
      rationale:
        'Increase HQLA to restore LCR above 100%. Short-duration T-bills maintain near-market yield.',
    },
  ],
  constraints: {
    hard: [
      {
        name: 'Net Worth Ratio >= 7.0%',
        threshold: 7.0,
        currentValue: 5.2,
        optimizedValue: 5.4,
        status: 'FAIL',
      },
      {
        name: 'LCR >= 100%',
        threshold: 100,
        currentValue: 85,
        optimizedValue: 102,
        status: 'PASS',
      },
    ],
    soft: [
      {
        name: 'Duration Gap < 2.0yr',
        threshold: 2.0,
        currentValue: 2.8,
        optimizedValue: 1.9,
        status: 'PASS',
      },
      {
        name: 'NIM >= 3.50%',
        threshold: 3.5,
        currentValue: 3.22,
        optimizedValue: 3.32,
        status: 'FAIL',
      },
    ],
  },
  nimImprovement: {
    bps: 10,
    annualizedDollars: 700000,
  },
  implementationSequence: [
    { order: 1, moveIndex: 1, dependency: 'None — can execute immediately' },
    {
      order: 2,
      moveIndex: 0,
      dependency:
        'Wait for HQLA buildup (move 1) to ensure LCR stays above 100%',
    },
  ],
  summary:
    'Optimization improves NIM by 10bps ($700K annual) and restores LCR above 100%. Net worth remains below 7% threshold — requires earnings retention and dividend suspension as separate capital action.',
  summaryEs:
    'La optimizacion mejora NIM en 10bps ($700K anual) y restaura LCR por encima de 100%. Patrimonio neto permanece debajo de 7% — requiere retencion de ganancias y suspension de dividendos.',
  auditTraceId: 'trace_co_exam_001',
};

// ─── Grade evaluation helper ────────────────────────────────────────────────

/** Returns true if the exam prep grade indicates remediation is needed (C, D, or F). */
function needsRemediation(examOutput: unknown): boolean {
  const output = examOutput as Record<string, unknown>;
  const grade = output.overallGrade as string;
  return ['C', 'D', 'F'].includes(grade);
}

/** Returns true if the exam prep grade is satisfactory (A or B). */
function isPassingGrade(examOutput: unknown): boolean {
  return !needsRemediation(examOutput);
}

// ─── Happy Path Chain (Grade B — stops after EXAM_PREP) ────────────────────

export const preExamHappyPathChain: ChainConfig = {
  id: 'pre_exam_happy',
  name: 'Pre-Exam Preparation — Happy Path (Grade B, no remediation)',
  steps: [
    {
      agentId: 'REGULATORY_COMPLIANCE',
      fixtureOutput: REGULATORY_COMPLIANCE_OUTPUT,
      tokenUsage: { inputTokens: 2200, outputTokens: 1800 },
    },
    {
      agentId: 'EXAM_PREP',
      fixtureOutput: EXAM_PREP_GRADE_B_OUTPUT,
      tokenUsage: { inputTokens: 3800, outputTokens: 3200 },
    },
    {
      agentId: 'CAPITAL_OPTIMIZER',
      fixtureOutput: CAPITAL_OPTIMIZER_OUTPUT,
      tokenUsage: { inputTokens: 4200, outputTokens: 3600 },
      // This step only runs if the exam grade is < C
      runCondition: (priorOutput) => needsRemediation(priorOutput),
    },
  ],
  inputTransforms: [
    // Step 0 (REGULATORY_COMPLIANCE): receives initial input
    (input) => input,
    // Step 1 (EXAM_PREP): receives compliance output enriched with chain source
    (prior) => ({
      chainSource: 'REGULATORY_COMPLIANCE',
      complianceData: prior,
    }),
    // Step 2 (CAPITAL_OPTIMIZER): receives exam prep output (only if grade < C)
    (prior) => ({ chainSource: 'EXAM_PREP', examData: prior }),
  ],
};

// ─── Remediation Path Chain (Grade D — continues to CAPITAL_OPTIMIZER) ──────

export const preExamRemediationChain: ChainConfig = {
  id: 'pre_exam_remediation',
  name: 'Pre-Exam Preparation — Remediation Path (Grade D, continues to optimizer)',
  steps: [
    {
      agentId: 'REGULATORY_COMPLIANCE',
      fixtureOutput: REGULATORY_COMPLIANCE_OUTPUT,
      tokenUsage: { inputTokens: 2200, outputTokens: 1800 },
    },
    {
      agentId: 'EXAM_PREP',
      fixtureOutput: EXAM_PREP_GRADE_D_OUTPUT,
      tokenUsage: { inputTokens: 3800, outputTokens: 4100 },
    },
    {
      agentId: 'CAPITAL_OPTIMIZER',
      fixtureOutput: CAPITAL_OPTIMIZER_OUTPUT,
      tokenUsage: { inputTokens: 4200, outputTokens: 3600 },
      // This step runs because grade D triggers remediation
      runCondition: (priorOutput) => needsRemediation(priorOutput),
    },
  ],
  inputTransforms: [
    (input) => input,
    (prior) => ({
      chainSource: 'REGULATORY_COMPLIANCE',
      complianceData: prior,
    }),
    (prior) => ({ chainSource: 'EXAM_PREP', examData: prior }),
  ],
};

// ─── Acceptance Criteria ────────────────────────────────────────────────────

export const PRE_EXAM_HAPPY_ACCEPTANCE = {
  minCompletedSteps: 2,
  requiredOutputKeys: [
    'agentId',
    'overallGrade',
    'camelAssessment',
    'remediationPlan',
  ],
  finalOutputPredicate: (output: unknown) => {
    const o = output as Record<string, unknown>;
    // Happy path: grade should be B, no capital optimizer needed
    return o.overallGrade === 'B' && (o.camelAssessment as any)?.composite <= 2;
  },
  maxTotalTokens: 30000,
};

export const PRE_EXAM_REMEDIATION_ACCEPTANCE = {
  requireAllSteps: true,
  requiredOutputKeys: ['agentId', 'moves', 'nimImprovement', 'constraints'],
  finalOutputPredicate: (output: unknown) => {
    const o = output as Record<string, unknown>;
    // Remediation path: capital optimizer ran, NIM improvement exists
    return (
      o.agentId === 'capital_optimizer' &&
      (o.nimImprovement as any)?.annualizedDollars > 0
    );
  },
  maxTotalTokens: 40000,
};

// Re-export fixtures for direct test access
export {
  REGULATORY_COMPLIANCE_OUTPUT,
  EXAM_PREP_GRADE_B_OUTPUT,
  EXAM_PREP_GRADE_D_OUTPUT,
  CAPITAL_OPTIMIZER_OUTPUT,
  needsRemediation,
  isPassingGrade,
};
