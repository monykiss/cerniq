import { ALMDecisionOutputSchema } from '../contracts/alm-decision.contracts';
import { CFOCopilotOutputSchema } from '../contracts/cfo-copilot.contracts';
import { CommitteeReportOutputSchema } from '../contracts/committee-report.contracts';
import { RiskMonitorOutputSchema } from '../contracts/risk-monitor.contracts';
import { StressTestOutputSchema } from '../contracts/stress-testing.contracts';
import { CapitalOptimizerOutputSchema } from '../contracts/capital-optimizer.contracts';
import { RegulatoryComplianceOutputSchema } from '../contracts/regulatory-compliance.contracts';
import { ExamPrepOutputSchema } from '../contracts/exam-prep.contracts';
import { LoanPricingOutputSchema } from '../contracts/loan-pricing.contracts';
import { DepositStrategyOutputSchema } from '../contracts/deposit-strategy.contracts';
import { PeerIntelligenceOutputSchema } from '../contracts/peer-intelligence.contracts';
import { BoardNarrativeOutputSchema } from '../contracts/board-narrative.contracts';

// Sanity fixtures for every agent output contract. These double as examples
// the LLM can reference when we wire structured-output mode in a later PR.

const validDecision = {
  agentId: 'alm_decision',
  version: '2.0',
  runId: 'r_1',
  institutionId: 'inst_1',
  timestamp: '2026-04-15T12:00:00Z',
  language: 'bilingual',
  healthSnapshot: {
    overall: 72,
    capital: 80,
    liquidity: 65,
    rateRisk: 60,
    credit: 75,
    concentration: 80,
    label: 'SATISFACTORY',
    trend: 'stable',
  },
  topRisks: Array.from({ length: 5 }, (_, i) => ({
    rank: i + 1,
    domain: 'Interest Rate Risk',
    priorityScore: 18,
    severity: 'HIGH',
    finding: 'x',
    findingEs: 'x',
    dollarImpact: -2100000,
    dollarImpactPct: -6.2,
    regulatoryRef: 'COSSEC 8917 §4.3',
    toolsUsed: ['runRateShock'],
  })),
  decisionQueue: Array.from({ length: 5 }, (_, i) => ({
    priority: i + 1,
    action: 'Shift $5M from 6m CDs to 2yr loans',
    actionEs: 'Transferir $5M de CDs 6m a préstamos 2yr',
    expectedImpact: '+$420K NII over 12 months',
    deadline: '60d',
    owner: 'CFO',
    regulatoryRef: 'COSSEC 8917 §4.3',
    status: 'PENDING',
  })),
  brief: 'Short brief.',
  briefEs: 'Breve resumen.',
  auditTraceId: 'a_1',
};

describe('ALMDecisionOutputSchema', () => {
  it('accepts a well-formed sample', () => {
    expect(ALMDecisionOutputSchema.safeParse(validDecision).success).toBe(true);
  });

  it('rejects a brief over 600 words (Bible §01)', () => {
    const bad = {
      ...validDecision,
      brief: Array.from({ length: 601 }, () => 'word').join(' '),
    };
    const r = ALMDecisionOutputSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('requires exactly 5 topRisks', () => {
    const bad = {
      ...validDecision,
      topRisks: validDecision.topRisks.slice(0, 4),
    };
    expect(ALMDecisionOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('requires exactly 5 decision queue items', () => {
    const bad = {
      ...validDecision,
      decisionQueue: validDecision.decisionQueue.slice(0, 4),
    };
    expect(ALMDecisionOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects priority score outside 1-27', () => {
    const bad = {
      ...validDecision,
      topRisks: [
        { ...validDecision.topRisks[0], priorityScore: 28 },
        ...validDecision.topRisks.slice(1),
      ],
    };
    expect(ALMDecisionOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CFOCopilotOutputSchema', () => {
  const valid = {
    agentId: 'cfo_copilot',
    runId: 'r_1',
    institutionId: 'inst_1',
    sessionId: 's_1',
    language: 'en',
    message: 'At +150bps, NII drops $1.8M (5.2%).',
    followups: Array.from({ length: 4 }, () => ({
      en: 'Run Monte Carlo',
      es: 'Ejecutar Monte Carlo',
    })),
    toolsCalled: ['runRateShock'],
  };

  it('accepts a valid sample', () => {
    expect(CFOCopilotOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires exactly 4 followups (Bible §04)', () => {
    const bad = { ...valid, followups: valid.followups.slice(0, 3) };
    expect(CFOCopilotOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a message over 300 words', () => {
    const bad = {
      ...valid,
      message: Array.from({ length: 301 }, () => 'word').join(' '),
    };
    expect(CFOCopilotOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects bilingual language (copilot is single-lang per turn)', () => {
    const bad = { ...valid, language: 'bilingual' };
    expect(CFOCopilotOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RiskMonitorOutputSchema', () => {
  it('accepts an empty alerts array (silence is signal)', () => {
    const sample = {
      agentId: 'risk_monitor',
      runId: 'r_1',
      institutionId: 'inst_1',
      scanKind: 'daily',
      alerts: [],
      alertCount: 0,
      quietRun: true,
    };
    expect(RiskMonitorOutputSchema.safeParse(sample).success).toBe(true);
  });

  it('validates alert deadline as ISO date (no time component)', () => {
    const sample = {
      agentId: 'risk_monitor',
      runId: 'r_1',
      institutionId: 'inst_1',
      scanKind: 'daily',
      alertCount: 1,
      quietRun: false,
      alerts: [
        {
          category: 'liquidity',
          severity: 'CRITICAL',
          metric: 'LCR',
          currentValue: 104,
          threshold: 105,
          delta: -1,
          trend: 'worsening',
          finding: 'LCR below threshold',
          findingEs: 'LCR debajo del umbral',
          recommendation: 'Shift cash into HQLA',
          regulatoryRef: 'NCUA 741.8',
          deadline: '2026-04-22T00:00:00Z',
          dedupSeed: 'lcr:critical:105',
        },
      ],
    };
    expect(RiskMonitorOutputSchema.safeParse(sample).success).toBe(false);
  });
});

describe('CommitteeReportOutputSchema', () => {
  const valid = {
    agentId: 'committee_report',
    sourceRunId: 'r_1',
    committeeType: 'board',
    language: 'bilingual',
    sections: {
      executiveSummary: 'short summary.',
      financialPosition: 'x',
      interestRateRisk: 'x',
      creditConcentration: 'x',
      liquidityRisk: 'x',
      peerComparison: 'x',
      recommendations: [
        {
          index: 1,
          action: 'Shift $5M',
          owner: 'CFO',
          deadline: '60d',
          expectedImpact: '+$420K',
          regulatoryRef: 'COSSEC 8917 §4.3',
        },
      ],
      regulatoryCalendar: [],
    },
    pdfPath: '/tmp/x.pdf',
    wordCount: 800,
  };

  it('accepts a valid sample', () => {
    expect(CommitteeReportOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an executive summary over 150 words', () => {
    const bad = {
      ...valid,
      sections: {
        ...valid.sections,
        executiveSummary: Array.from({ length: 151 }, () => 'word').join(' '),
      },
    };
    expect(CommitteeReportOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 05 — Stress Testing ═══════════════════════════════════════

describe('StressTestOutputSchema', () => {
  const scenario = (id: string, classification: string = 'PASS') => ({
    scenarioId: id,
    name: `Test ${id}`,
    rateShiftBps: 200,
    depositShockPct: 0,
    creditShockPct: 0,
    prExclusive: false,
    niiImpact: -1500000,
    niiImpactPct: -4.5,
    eveImpact: -2000000,
    eveImpactPct: -3.2,
    totalImpact: -3500000,
    classification,
    ...(classification !== 'PASS'
      ? { mitigation: 'Shift duration', mitigationEs: 'Ajustar duración' }
      : {}),
  });

  const valid = {
    agentId: 'stress_testing',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    scenarios: Array.from({ length: 8 }, (_, i) => scenario(`s_${i}`)),
    worstCase: {
      scenarioId: 's_0',
      totalImpact: -3500000,
      classification: 'PASS',
    },
    summary: 'All scenarios pass.',
    summaryEs: 'Todos los escenarios pasan.',
    auditTraceId: 'a_1',
  };

  it('accepts a valid suite', () => {
    expect(StressTestOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires minimum 6 scenarios', () => {
    const bad = { ...valid, scenarios: valid.scenarios.slice(0, 5) };
    expect(StressTestOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('WARN/FAIL scenarios must include mitigation', () => {
    const bad = {
      ...valid,
      scenarios: [
        {
          ...scenario('s_0', 'WARN'),
          mitigation: undefined,
          mitigationEs: undefined,
        },
        ...valid.scenarios.slice(1),
      ],
    };
    expect(StressTestOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('FAIL worst-case must include actionPlan', () => {
    const bad = {
      ...valid,
      worstCase: {
        scenarioId: 's_0',
        totalImpact: -5000000,
        classification: 'FAIL',
      },
    };
    expect(StressTestOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 06 — Capital Optimizer ════════════════════════════════════

describe('CapitalOptimizerOutputSchema', () => {
  const valid = {
    agentId: 'capital_optimizer',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    currentState: [
      {
        category: 'Fixed Loans',
        balance: 100000000,
        yield: 5.5,
        duration: 3.2,
      },
    ],
    optimizedState: [
      { category: 'Fixed Loans', balance: 95000000, yield: 5.7, duration: 2.8 },
    ],
    moves: [
      {
        source: 'Fixed Loans',
        target: '2yr CDs',
        amount: 5000000,
        timeline: '30d',
        nimImpactBps: 15,
        nimImpactDollars: 420000,
        rationale: 'Reduce duration gap',
      },
    ],
    constraints: {
      hard: [
        {
          name: 'Net Worth ≥ 7%',
          threshold: 7,
          currentValue: 9.2,
          optimizedValue: 9.1,
          status: 'PASS',
        },
      ],
      soft: [
        {
          name: 'Duration gap < 0.5yr',
          threshold: 0.5,
          currentValue: 0.8,
          optimizedValue: 0.4,
          status: 'PASS',
        },
      ],
    },
    nimImprovement: { bps: 15, annualizedDollars: 420000 },
    implementationSequence: [{ order: 1, moveIndex: 0 }],
    summary: 'NIM +15bps.',
    summaryEs: 'NIM +15bps.',
    auditTraceId: 'a_1',
  };

  it('accepts a valid sample', () => {
    expect(CapitalOptimizerOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects NIM improvement below $50K (Bible §06 minimum)', () => {
    const bad = {
      ...valid,
      nimImprovement: { bps: 1, annualizedDollars: 30000 },
    };
    expect(CapitalOptimizerOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 07 — Regulatory Compliance ═══════════════════════════════

describe('RegulatoryComplianceOutputSchema', () => {
  const valid = {
    agentId: 'regulatory_compliance',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    dashboard: {
      red: [],
      amber: [
        {
          deadlineId: 'd_1',
          category: 'FILING',
          description: '5300 Call Report',
          descriptionEs: 'Informe 5300',
          regulatoryBody: 'NCUA',
          regulationRef: 'NCUA Form 5300',
          dueDate: '2026-05-01T00:00:00Z',
          daysUntilDue: 16,
          rag: 'AMBER',
          status: 'IN_PREPARATION',
        },
      ],
      green: [],
    },
    summary: 'One filing due within 30 days.',
    summaryEs: 'Un informe pendiente en 30 días.',
    auditTraceId: 'a_1',
  };

  it('accepts a valid dashboard', () => {
    expect(RegulatoryComplianceOutputSchema.safeParse(valid).success).toBe(
      true,
    );
  });

  it('rejects invalid regulatory body', () => {
    const bad = structuredClone(valid);
    bad.dashboard.amber[0].regulatoryBody = 'FBI' as any;
    expect(RegulatoryComplianceOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 08 — Exam Prep ════════════════════════════════════════════

describe('ExamPrepOutputSchema', () => {
  const camelComponent = (c: string) => ({
    component: c,
    score: 2,
    finding: 'x',
    findingEs: 'x',
    remediation: 'y',
    remediationEs: 'y',
  });

  const valid = {
    agentId: 'exam_prep',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    camelAssessment: {
      composite: 2,
      components: [
        'CAPITAL',
        'ASSET_QUALITY',
        'MANAGEMENT',
        'EARNINGS',
        'LIQUIDITY',
      ].map(camelComponent),
    },
    governanceChecklist: {
      total: 24,
      passed: 20,
      items: Array.from({ length: 24 }, (_, i) => ({
        item: `Item ${i + 1}`,
        status: i < 20 ? 'PASS' : 'FAIL',
      })),
    },
    redFlags: [],
    documentChecklist: [{ document: 'BSA/AML Policy', status: 'READY' }],
    remediationPlan: [],
    managementLetterDraft: 'Draft response.',
    managementLetterDraftEs: 'Borrador de respuesta.',
    auditTraceId: 'a_1',
  };

  it('accepts a valid exam prep package', () => {
    expect(ExamPrepOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires exactly 5 CAMEL components', () => {
    const bad = {
      ...valid,
      camelAssessment: {
        composite: 2,
        components: [camelComponent('CAPITAL')],
      },
    };
    expect(ExamPrepOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects CAMEL score outside 1-5', () => {
    const bad = {
      ...valid,
      camelAssessment: {
        composite: 6,
        components: valid.camelAssessment.components,
      },
    };
    expect(ExamPrepOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 09 — Loan Pricing ════════════════════════════════════════

describe('LoanPricingOutputSchema', () => {
  const comp = (c: string, bps: number) => ({
    component: c,
    bps,
    rationale: 'x',
  });
  const option = (tier: string, rate: number) => ({
    tier,
    rate,
    rateBps: Math.round(rate * 100),
    annualRevenue: 50000,
    components: [
      comp('FTP_BASE', 200),
      comp('CREDIT_SPREAD', 100),
      comp('CECL_CAPITAL_CHARGE', 50),
      comp('OPERATING_COST', 30),
      comp('LIQUIDITY_PREMIUM', 10),
      comp('PROFIT_MARGIN', 25),
    ],
  });

  const valid = {
    agentId: 'loan_pricing',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    loanParams: {
      amount: 500000,
      termMonths: 60,
      sector: 'Commercial RE',
      riskGrade: 'B+',
    },
    concentrationCheck: {
      sectorCurrentPct: 15,
      sectorLimit: 20,
      nearLimit: false,
      premiumApplied: false,
      premiumBps: 0,
    },
    pricingOptions: [
      option('MINIMUM', 4.15),
      option('TARGET', 4.4),
      option('PREMIUM', 4.9),
    ],
    peerAverage: { rate: 4.35, source: 'NCUA Q4 2025' },
    recommendation: {
      tier: 'TARGET',
      rate: 4.4,
      rationale: 'Competitive with peers, covers all costs + 25bps margin.',
      rationaleEs:
        'Competitivo con pares, cubre todos los costos + 25bps margen.',
    },
    auditTraceId: 'a_1',
  };

  it('accepts a valid pricing output', () => {
    expect(LoanPricingOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires first option to be MINIMUM tier', () => {
    const bad = {
      ...valid,
      pricingOptions: [
        option('TARGET', 4.4),
        option('MINIMUM', 4.15),
        option('PREMIUM', 4.9),
      ],
    };
    expect(LoanPricingOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('requires exactly 3 pricing options (tuple)', () => {
    const bad = {
      ...valid,
      pricingOptions: [option('MINIMUM', 4.15), option('TARGET', 4.4)],
    };
    expect(LoanPricingOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 10 — Deposit Strategy ════════════════════════════════════

describe('DepositStrategyOutputSchema', () => {
  const valid = {
    agentId: 'deposit_strategy',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    currentState: {
      products: [
        {
          product: 'Checking',
          balance: 50000000,
          mixPct: 30,
          costBps: 10,
          beta: 0.05,
          decayRate: 0.02,
        },
      ],
      weightedAvgCostBps: 85,
      weightedAvgMaturityMonths: 8,
      totalDeposits: 150000000,
    },
    repricingRecommendations: [
      {
        product: '12m CD',
        action: 'CUT',
        currentRateBps: 450,
        recommendedRateBps: 425,
        peerRateBps: 430,
        rationale: 'Above peer without justification',
        rationaleEs: 'Por encima de pares sin justificación',
      },
    ],
    mixOptimization: {
      targetMix: [
        {
          product: 'Checking',
          currentPct: 30,
          targetPct: 35,
          rationale: 'Increase low-cost core',
        },
      ],
      expectedCostReductionBps: 12,
      timelineMonths: 6,
    },
    maturityCliffs: [],
    summary: 'x',
    summaryEs: 'x',
    auditTraceId: 'a_1',
  };

  it('accepts a valid deposit strategy', () => {
    expect(DepositStrategyOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects deposit beta outside 0-1', () => {
    const bad = structuredClone(valid);
    bad.currentState.products[0].beta = 1.5;
    expect(DepositStrategyOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 11 — Peer Intelligence ═══════════════════════════════════

describe('PeerIntelligenceOutputSchema', () => {
  const peerMetric = (metric: string) => ({
    metric,
    category: 'PROFITABILITY' as const,
    institutionValue: 3.2,
    peerMedian: 3.5,
    gapBps: -30,
    quartile: 'Q2' as const,
    trend: 'stable' as const,
  });

  const valid = {
    agentId: 'peer_intelligence',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    peerCohort: {
      description: 'PR cooperativas $50M-$500M',
      count: 42,
      assetRange: { minMillions: 50, maxMillions: 500 },
    },
    performanceOverview: ['NIM', 'ROA', 'ROE', 'LCR', 'NetWorth', 'NPL'].map(
      peerMetric,
    ),
    wins: [{ metric: 'LCR', movement: 'Q3→Q2' }],
    urgentGaps: [],
    competitiveGaps: [
      {
        metric: 'NIM',
        institutionValue: 3.2,
        peerMedian: 3.5,
        gapBps: -30,
        dollarImpactOfClosing: 840000,
        recommendation: 'Reprice CD book',
        recommendationEs: 'Reajustar CDs',
      },
    ],
    marketIntelligence: {
      rateEnvironment: 'Flat',
      notablePeerMoves: ['Caguas launched 15m CD special at 4.75%'],
    },
    quarterlyRanking: ['NIM', 'ROA', 'ROE', 'LCR', 'NetWorth', 'NPL'].map(
      peerMetric,
    ),
    summary: 'x',
    summaryEs: 'x',
    auditTraceId: 'a_1',
  };

  it('accepts a valid peer digest', () => {
    expect(PeerIntelligenceOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires minimum 6 performance metrics', () => {
    const bad = { ...valid, performanceOverview: [peerMetric('NIM')] };
    expect(PeerIntelligenceOutputSchema.safeParse(bad).success).toBe(false);
  });
});

// ═══ AGENT 12 — Board Narrative ═════════════════════════════════════

describe('BoardNarrativeOutputSchema', () => {
  const topic = (t: string) => ({
    topic: t,
    situation: 'x',
    situationEs: 'x',
    whyItMatters: 'x',
    whyItMattersEs: 'x',
    whatWeAreDoing: 'x',
    whatWeAreDoingEs: 'x',
  });

  const valid = {
    agentId: 'board_narrative',
    version: '1.0',
    runId: 'r_1',
    institutionId: 'inst_1',
    timestamp: '2026-04-15T12:00:00Z',
    language: 'bilingual',
    outputType: 'BOARD_PACKET',
    topics: [topic('Capital'), topic('Liquidity'), topic('Earnings')],
    decisionsRequired: [
      {
        decision: 'Approve IRR policy',
        decisionEs: 'Aprobar política IRR',
        urgency: 'NEXT_MEETING',
        context: 'Annual renewal',
      },
    ],
    narrative: 'Full narrative here.',
    narrativeEs: 'Narrativa completa aquí.',
    auditTraceId: 'a_1',
  };

  it('accepts a valid board narrative', () => {
    expect(BoardNarrativeOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires 3-7 topics', () => {
    const tooFew = { ...valid, topics: [topic('Capital'), topic('Liquidity')] };
    expect(BoardNarrativeOutputSchema.safeParse(tooFew).success).toBe(false);

    const tooMany = {
      ...valid,
      topics: Array.from({ length: 8 }, (_, i) => topic(`T${i}`)),
    };
    expect(BoardNarrativeOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it('talking points must be ≤120 chars each', () => {
    const bad = {
      ...valid,
      talkingPoints: Array.from({ length: 5 }, () => ({
        point: 'x'.repeat(121),
        pointEs: 'x'.repeat(121),
      })),
    };
    expect(BoardNarrativeOutputSchema.safeParse(bad).success).toBe(false);
  });
});
