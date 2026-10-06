/**
 * Monthly Governance Chain — Fixture Data
 *
 * Vol.1 Bible Pattern 1: Monthly Governance Cycle
 * RISK_MONITOR -> ALM_DECISION -> PEER_INTELLIGENCE -> COMMITTEE_REPORT -> BOARD_NARRATIVE
 *
 * This fixture provides realistic output for each step and defines the
 * input transforms that mirror the production chain in agent-chain.service.ts.
 */

import type { ChainConfig } from '../cross-agent-regression.harness';

// ─── Step 1: Risk Monitor Output ────────────────────────────────────────────

const RISK_MONITOR_OUTPUT = {
  agentId: 'risk_monitor',
  runId: 'run_rm_governance_001',
  institutionId: 'inst_caguas_001',
  scanKind: 'monthly',
  alerts: [
    {
      category: 'rate_risk',
      severity: 'HIGH',
      metric: 'NII_Sensitivity_200bps',
      currentValue: -6.2,
      threshold: -5.0,
      delta: -1.2,
      trend: 'worsening',
      finding:
        'NII sensitivity at +200bps exceeds policy limit by 120bps. Duration gap widened to -1.8yr.',
      findingEs:
        'Sensibilidad NII a +200bps excede limite de politica por 120bps. Brecha de duracion ampliada a -1.8yr.',
      recommendation:
        'Shift $15M from 5yr fixed to 1yr variable to reduce duration gap.',
      regulatoryRef: 'COSSEC Carta Circular 2021-02',
      deadline: '2026-06-15',
      dedupSeed: 'nii_200bps_breach_2026Q2',
    },
    {
      category: 'liquidity',
      severity: 'HIGH',
      metric: 'LCR',
      currentValue: 112,
      threshold: 120,
      delta: -8,
      trend: 'worsening',
      finding: 'LCR at 112%, trending down from 128% last quarter.',
      findingEs:
        'LCR en 112%, tendencia a la baja desde 128% el trimestre pasado.',
      recommendation: 'Increase HQLA buffer by $2M via T-bill ladder.',
      regulatoryRef: 'COSSEC Reg. 8866',
      deadline: '2026-05-15',
      dedupSeed: 'lcr_breach_2026Q2',
    },
  ],
  alertCount: 2,
  quietRun: false,
};

// ─── Step 2: ALM Decision Output ────────────────────────────────────────────

const ALM_DECISION_OUTPUT = {
  agentId: 'alm_decision',
  version: '2.0',
  runId: 'run_alm_governance_001',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T10:00:00.000Z',
  language: 'bilingual',
  healthSnapshot: {
    overall: 64,
    capital: 78,
    liquidity: 58,
    rateRisk: 52,
    credit: 71,
    concentration: 66,
    label: 'FAIR',
    trend: 'deteriorating',
  },
  topRisks: [
    {
      rank: 1,
      domain: 'Interest Rate Risk',
      priorityScore: 18,
      severity: 'HIGH',
      finding: 'NII at +200bps drops 6.2% ($2.1M). Duration gap -1.8yr.',
      findingEs:
        'NII a +200bps disminuye 6.2% ($2.1M). Brecha de duracion -1.8yr.',
      dollarImpact: 2100000,
      dollarImpactPct: 6.2,
      regulatoryRef: 'COSSEC Carta Circular 2021-02',
      toolsUsed: ['runFullSwarm', 'runRateShock'],
    },
    {
      rank: 2,
      domain: 'Liquidity Risk',
      priorityScore: 15,
      severity: 'HIGH',
      finding: 'LCR at 112% — trending down from 128%.',
      findingEs: 'LCR en 112% — tendencia a la baja desde 128%.',
      dollarImpact: 850000,
      dollarImpactPct: 2.5,
      regulatoryRef: 'COSSEC Reg. 8866',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 3,
      domain: 'Concentration Risk',
      priorityScore: 10,
      severity: 'MEDIUM',
      finding: 'Auto loan HHI: 2,840. 34% single sector.',
      findingEs: 'HHI auto: 2,840. 34% un solo sector.',
      dollarImpact: 640000,
      dollarImpactPct: 1.9,
      regulatoryRef: 'COSSEC Carta Circular 2019-01',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 4,
      domain: 'Credit Risk',
      priorityScore: 8,
      severity: 'MEDIUM',
      finding: 'CECL coverage 1.42% vs peer 1.58%.',
      findingEs: 'Cobertura CECL 1.42% vs pares 1.58%.',
      dollarImpact: 380000,
      dollarImpactPct: 1.1,
      regulatoryRef: 'ASC 326-20',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 5,
      domain: 'Capital Adequacy',
      priorityScore: 5,
      severity: 'LOW',
      finding: 'Net worth 7.4% (threshold 7.0%). Declining 20bps QoQ.',
      findingEs: 'Patrimonio neto 7.4% (umbral 7.0%). Disminuyendo 20bps QoQ.',
      dollarImpact: 210000,
      dollarImpactPct: 0.6,
      regulatoryRef: 'NCUA \u00a7702.102',
      toolsUsed: ['runFullSwarm'],
    },
  ],
  decisionQueue: [
    {
      priority: 1,
      action: 'Shift $15M from 5yr fixed to 1yr variable.',
      actionEs: 'Mover $15M de fijo 5yr a variable 1yr.',
      expectedImpact: '+12bps NIM (+$840K)',
      deadline: '60d',
      owner: 'CFO',
      regulatoryRef: 'COSSEC 2021-02',
      status: 'PENDING',
    },
    {
      priority: 2,
      action: 'Increase HQLA buffer by $2M via T-bill ladder.',
      actionEs: 'Aumentar colchon HQLA en $2M via escalera de T-bills.',
      expectedImpact: 'LCR +9pp to 121%',
      deadline: '30d',
      owner: 'CFO',
      regulatoryRef: 'COSSEC Reg. 8866',
      status: 'PENDING',
    },
    {
      priority: 3,
      action: 'Cap auto originations at 30%.',
      actionEs: 'Limitar originaciones auto a 30%.',
      expectedImpact: 'HHI ~2,400 in 90d',
      deadline: '90d',
      owner: 'ALM_COMMITTEE',
      regulatoryRef: 'COSSEC 2019-01',
      status: 'PENDING',
    },
    {
      priority: 4,
      action: 'Increase CECL reserve $380K in CRE.',
      actionEs: 'Aumentar reserva CECL $380K en CRE.',
      expectedImpact: 'Coverage to peer median',
      deadline: '30d',
      owner: 'CFO',
      regulatoryRef: 'ASC 326-20',
      status: 'PENDING',
    },
    {
      priority: 5,
      action: 'Review capital stress scenarios.',
      actionEs: 'Revisar escenarios de estres de capital.',
      expectedImpact: 'Maintain well-capitalized',
      deadline: '60d',
      owner: 'BOARD',
      regulatoryRef: 'NCUA \u00a7702.102',
      status: 'PENDING',
    },
  ],
  brief:
    'Cooperativa de Ahorro y Credito Ejemplo Centro faces elevated interest rate risk. NII sensitivity at +200bps exceeds policy by 70bps, driven by duration mismatch from fixed-rate auto lending. Liquidity trending down with LCR at 112%. Priority action: restructure rate risk exposure ($840K annual benefit).',
  briefEs:
    'Cooperativa de Ahorro y Credito Ejemplo Centro enfrenta riesgo de tasa elevado. Sensibilidad NII a +200bps excede politica por 70bps. La liquidez tiende a la baja con LCR en 112%. Accion prioritaria: reestructurar exposicion de tasa.',
  auditTraceId: 'trace_alm_governance_001',
};

// ─── Step 3: Peer Intelligence Output ───────────────────────────────────────

const PEER_INTELLIGENCE_OUTPUT = {
  agentId: 'peer_intelligence',
  version: '1.0',
  runId: 'run_peer_governance_001',
  institutionId: 'inst_caguas_001',
  timestamp: '2026-04-15T10:05:00.000Z',
  language: 'bilingual',
  peerCohort: {
    description: 'PR cooperativas $100M-$500M total assets',
    count: 18,
    assetRange: { minMillions: 100, maxMillions: 500 },
  },
  performanceOverview: [
    {
      metric: 'NIM',
      category: 'PROFITABILITY',
      institutionValue: 3.42,
      peerMedian: 3.68,
      gapBps: -26,
      quartile: 'Q3',
      trend: 'deteriorating',
    },
    {
      metric: 'ROA',
      category: 'PROFITABILITY',
      institutionValue: 0.62,
      peerMedian: 0.78,
      gapBps: -16,
      quartile: 'Q3',
      trend: 'stable',
    },
    {
      metric: 'Net Worth Ratio',
      category: 'CAPITAL',
      institutionValue: 7.4,
      peerMedian: 8.2,
      gapBps: -80,
      quartile: 'Q3',
      trend: 'deteriorating',
    },
    {
      metric: 'LCR',
      category: 'LIQUIDITY',
      institutionValue: 112,
      peerMedian: 135,
      gapBps: -2300,
      quartile: 'Q4',
      trend: 'deteriorating',
    },
    {
      metric: 'Delinquency Rate',
      category: 'ASSET_QUALITY',
      institutionValue: 2.1,
      peerMedian: 1.8,
      gapBps: 30,
      quartile: 'Q3',
      trend: 'stable',
    },
    {
      metric: 'Loan Growth',
      category: 'GROWTH',
      institutionValue: 4.2,
      peerMedian: 5.8,
      gapBps: -160,
      quartile: 'Q3',
      trend: 'stable',
    },
  ],
  wins: [
    {
      metric: 'Operating Efficiency',
      movement: 'Improved from Q3 to Q2 quartile',
    },
  ],
  urgentGaps: [
    { metric: 'LCR', movement: 'Dropped from Q3 to Q4 quartile' },
    { metric: 'NIM', movement: 'Gap widened by 8bps vs prior quarter' },
  ],
  competitiveGaps: [
    {
      metric: 'NIM',
      institutionValue: 3.42,
      peerMedian: 3.68,
      gapBps: -26,
      dollarImpactOfClosing: 728000,
      recommendation: 'Reprice $45M in below-market loans at renewal.',
      recommendationEs:
        'Repreciar $45M en prestamos bajo mercado en renovacion.',
    },
  ],
  marketIntelligence: {
    rateEnvironment:
      'Fed funds rate stable at 4.25-4.50%. Market expects 2 cuts in H2 2026.',
    peerCdSpecials:
      'Ejemplo Este offering 5.25% 12mo CD; Ejemplo Centro peer at 4.75%.',
    notablePeerMoves: [
      'ACACIA launched digital lending platform — 15% origination increase',
      'Ejemplo Norte increased HQLA allocation by $5M',
    ],
  },
  quarterlyRanking: [],
  summary:
    'Ejemplo Centro ranks in Q3 for most metrics, Q4 for LCR. NIM gap widening — competitive pressure from peer CD specials.',
  summaryEs:
    'Ejemplo Centro se ubica en Q3 para la mayoria de metricas, Q4 para LCR. Brecha de NIM ampliandose.',
  auditTraceId: 'trace_peer_governance_001',
};

// ─── Step 4: Committee Report Output ────────────────────────────────────────

const COMMITTEE_REPORT_OUTPUT = {
  agentId: 'committee_report',
  sourceRunId: 'run_peer_governance_001',
  committeeType: 'board',
  language: 'bilingual',
  sections: {
    executiveSummary:
      'Cooperativa Ejemplo Centro faces elevated risk driven by interest rate sensitivity exceeding policy limits and declining liquidity coverage. Peer comparison shows widening competitive gaps. Immediate action required on rate risk restructuring.',
    financialPosition:
      'Total assets $285M. Net worth ratio 7.4% (above minimum but declining). NIM 3.42% vs peer 3.68%.',
    interestRateRisk:
      'NII sensitivity at +200bps: -6.2% ($2.1M). Duration gap -1.8yr. Policy limit exceeded by 120bps. Recommended: shift $15M from 5yr fixed to 1yr variable.',
    creditConcentration:
      'Auto loan HHI 2,840 (above 2,500 threshold). 34% single-sector concentration. Cap originations at 30%.',
    liquidityRisk:
      'LCR at 112%, trending down from 128%. Peer median 135%. Increase HQLA buffer $2M via T-bill ladder.',
    peerComparison:
      'Q3 quartile for most metrics, Q4 for LCR. NIM gap widened 8bps QoQ. Competitive pressure from peer CD specials (Ejemplo Este 5.25% 12mo).',
    recommendations: [
      {
        index: 1,
        action: 'Restructure $15M rate risk exposure',
        owner: 'CFO',
        deadline: '60d',
        expectedImpact: '+$840K annual NIM',
        regulatoryRef: 'COSSEC 2021-02',
      },
      {
        index: 2,
        action: 'Increase HQLA $2M via T-bills',
        owner: 'CFO',
        deadline: '30d',
        expectedImpact: 'LCR +9pp to 121%',
        regulatoryRef: 'COSSEC Reg. 8866',
      },
      {
        index: 3,
        action: 'Cap auto originations at 30%',
        owner: 'ALM_COMMITTEE',
        deadline: '90d',
        expectedImpact: 'HHI below 2,500',
        regulatoryRef: 'COSSEC 2019-01',
      },
    ],
    regulatoryCalendar: [
      {
        dueDate: '2026-06-30',
        filing: 'COSSEC Quarterly Call Report',
        status: 'IN_PREPARATION',
        owner: 'Finance',
        regulatoryRef: 'COSSEC Reg. 8866',
      },
      {
        dueDate: '2026-07-31',
        filing: 'NCUA 5300 Call Report',
        status: 'IN_PREPARATION',
        owner: 'Finance',
        regulatoryRef: 'NCUA Part 741',
      },
    ],
  },
  pdfPath: '/reports/committee/governance_2026Q2_caguas.pdf',
  wordCount: 342,
};

// ─── Step 5: Board Narrative Output ─────────────────────────────────────────

const BOARD_NARRATIVE_OUTPUT = {
  agentId: 'board_narrative',
  version: '1.0',
  runId: 'run_bn_governance_001',
  institutionId: 'inst_caguas_001',
  institutionName: 'Cooperativa de Ahorro y Credito Ejemplo Centro',
  timestamp: '2026-04-15T10:10:00.000Z',
  language: 'bilingual',
  outputType: 'BOARD_PACKET',
  topics: [
    {
      topic: 'Interest Rate Risk',
      situation:
        'Our interest rate sensitivity at +200bps is -6.2%, exceeding our policy limit of -5.0%.',
      situationEs:
        'Nuestra sensibilidad de tasa a +200bps es -6.2%, excediendo nuestro limite de politica de -5.0%.',
      whyItMatters:
        'If rates rise 200bps, we lose $2.1M in net interest income annually. Our duration gap of -1.8 years amplifies this risk.',
      whyItMattersEs:
        'Si las tasas suben 200bps, perdemos $2.1M en ingresos netos anuales. Nuestra brecha de duracion de -1.8 anos amplifica este riesgo.',
      whatWeAreDoing:
        'Management recommends shifting $15M from 5-year fixed to 1-year variable instruments, improving NIM by $840K annually.',
      whatWeAreDoingEs:
        'La gerencia recomienda mover $15M de instrumentos fijos a 5 anos a variables a 1 ano, mejorando NIM en $840K anuales.',
    },
    {
      topic: 'Liquidity Position',
      situation:
        'Our Liquidity Coverage Ratio has declined to 112%, down from 128% last quarter.',
      situationEs:
        'Nuestro Ratio de Cobertura de Liquidez ha disminuido a 112%, desde 128% el trimestre pasado.',
      whyItMatters:
        'We are approaching the regulatory minimum. Our peer median is 135%, placing us in the bottom quartile.',
      whyItMattersEs:
        'Nos acercamos al minimo regulatorio. La mediana de nuestros pares es 135%, ubicandonos en el cuartil inferior.',
      whatWeAreDoing:
        'We are building a $2M T-bill ladder to restore LCR to 121% within 30 days.',
      whatWeAreDoingEs:
        'Estamos construyendo una escalera de T-bills de $2M para restaurar LCR a 121% en 30 dias.',
    },
    {
      topic: 'Competitive Position',
      situation:
        'We rank in the third quartile for most metrics and fourth quartile for liquidity among PR cooperativas of similar size.',
      situationEs:
        'Nos ubicamos en el tercer cuartil para la mayoria de metricas y cuarto cuartil para liquidez entre cooperativas PR de tamano similar.',
      whyItMatters:
        'Our NIM gap vs peers widened 8bps this quarter. Competitors are offering aggressive CD rates.',
      whyItMattersEs:
        'Nuestra brecha de NIM vs pares se amplio 8bps este trimestre. Los competidores ofrecen tasas agresivas de CD.',
      whatWeAreDoing:
        'We plan to reprice $45M in below-market loans at renewal, targeting $728K in additional income.',
      whatWeAreDoingEs:
        'Planeamos repreciar $45M en prestamos bajo mercado en renovacion, apuntando a $728K en ingresos adicionales.',
    },
  ],
  decisionsRequired: [
    {
      decision:
        'Approve $15M portfolio restructuring to reduce interest rate risk',
      decisionEs:
        'Aprobar reestructuracion de portafolio de $15M para reducir riesgo de tasa',
      urgency: 'IMMEDIATE',
      context:
        'Current NII sensitivity exceeds policy limit. Expected benefit: +$840K annual NIM improvement.',
    },
    {
      decision: 'Approve $2M HQLA increase via T-bill ladder',
      decisionEs: 'Aprobar aumento HQLA de $2M via escalera de T-bills',
      urgency: 'IMMEDIATE',
      context:
        'LCR trending toward regulatory minimum. Target: restore to 121% within 30 days.',
    },
    {
      decision: 'Review auto lending concentration limits',
      decisionEs: 'Revisar limites de concentracion de prestamos auto',
      urgency: 'NEXT_MEETING',
      context:
        'Auto loan HHI at 2,840 exceeds 2,500 threshold. Proposed: cap originations at 30%.',
    },
  ],
  narrative:
    'Cooperativa de Ahorro y Credito Ejemplo Centro faces elevated interest rate risk with NII sensitivity exceeding policy limits. Liquidity coverage is declining and peer comparisons reveal widening competitive gaps. Management recommends immediate portfolio restructuring ($15M shift) and HQLA buildup ($2M T-bill ladder). These actions are projected to improve NIM by $840K annually and restore LCR above 120%.',
  narrativeEs:
    'Cooperativa de Ahorro y Credito Ejemplo Centro enfrenta riesgo de tasa elevado con sensibilidad NII excediendo limites de politica. La cobertura de liquidez esta disminuyendo y las comparaciones con pares revelan brechas competitivas ampliandose. La gerencia recomienda reestructuracion inmediata del portafolio ($15M) y aumento de HQLA (escalera T-bills $2M). Se proyecta que estas acciones mejoren NIM en $840K anuales y restauren LCR por encima de 120%.',
  auditTraceId: 'trace_bn_governance_001',
};

// ─── Chain Configuration ────────────────────────────────────────────────────

export const monthlyGovernanceChain: ChainConfig = {
  id: 'monthly_governance',
  name: 'Monthly Governance Cycle (Vol.1 Pattern 1)',
  steps: [
    {
      agentId: 'RISK_MONITOR',
      fixtureOutput: RISK_MONITOR_OUTPUT,
      tokenUsage: { inputTokens: 2800, outputTokens: 1200 },
    },
    {
      agentId: 'ALM_DECISION',
      fixtureOutput: ALM_DECISION_OUTPUT,
      tokenUsage: { inputTokens: 4500, outputTokens: 3200 },
    },
    {
      agentId: 'PEER_INTELLIGENCE',
      fixtureOutput: PEER_INTELLIGENCE_OUTPUT,
      tokenUsage: { inputTokens: 3200, outputTokens: 2400 },
    },
    {
      agentId: 'COMMITTEE_REPORT',
      fixtureOutput: COMMITTEE_REPORT_OUTPUT,
      tokenUsage: { inputTokens: 5100, outputTokens: 3800 },
    },
    {
      agentId: 'BOARD_NARRATIVE',
      fixtureOutput: BOARD_NARRATIVE_OUTPUT,
      tokenUsage: { inputTokens: 4800, outputTokens: 4200 },
    },
  ],
  inputTransforms: [
    // Step 0 (RISK_MONITOR): receives initial input verbatim
    (input) => input,
    // Step 1 (ALM_DECISION): receives risk monitor output enriched with chainSource
    (prior) => ({
      ...((prior ?? {}) as Record<string, unknown>),
      chainSource: 'RISK_MONITOR',
    }),
    // Step 2 (PEER_INTELLIGENCE): receives ALM decision output wrapped
    (prior) => ({ sourceRunOutput: prior }),
    // Step 3 (COMMITTEE_REPORT): receives peer output with committee config
    (prior) => ({
      sourceRunOutput: prior,
      committeeType: 'board',
      language: 'bilingual',
    }),
    // Step 4 (BOARD_NARRATIVE): receives committee output with output type
    (prior) => ({ sourceRunOutput: prior, outputType: 'BOARD_PACKET' }),
  ],
};

// ─── Acceptance Criteria ────────────────────────────────────────────────────

export const MONTHLY_GOVERNANCE_ACCEPTANCE = {
  requireAllSteps: true,
  requiredOutputKeys: [
    'agentId',
    'narrative',
    'narrativeEs',
    'topics',
    'decisionsRequired',
  ],
  finalOutputPredicate: (output: unknown) => {
    const o = output as Record<string, unknown>;

    // Board narrative must reference the institution name
    const narrative = o.narrative as string;
    if (!narrative?.includes('Ejemplo Centro')) return false;

    // Must contain risk summary (interest rate risk mentioned)
    if (!narrative?.toLowerCase().includes('interest rate')) return false;

    // Must contain recommendations
    const decisions = o.decisionsRequired as Array<Record<string, unknown>>;
    if (!Array.isArray(decisions) || decisions.length < 2) return false;

    // Must be bilingual
    const narrativeEs = o.narrativeEs as string;
    if (!narrativeEs || narrativeEs.length === 0) return false;

    return true;
  },
  maxTotalTokens: 50000,
  maxCostUsd: 0.5,
};

// Re-export fixture outputs for use in tests
export {
  RISK_MONITOR_OUTPUT,
  ALM_DECISION_OUTPUT,
  PEER_INTELLIGENCE_OUTPUT,
  COMMITTEE_REPORT_OUTPUT,
  BOARD_NARRATIVE_OUTPUT,
};
