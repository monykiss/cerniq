/**
 * Agent execution layer — frontend type surface.
 *
 * Mirrors the backend Zod contracts under `backend-node/src/agents/contracts/*`
 * exactly. We duplicate rather than import so the frontend build doesn't pull
 * zod/prisma into its bundle. When the backend exports a types barrel, swap
 * imports here and delete the duplication — drift is caught by a golden
 * type-level test.
 *
 * Source of truth:
 *   backend-node/src/agents/contracts/common.contracts.ts
 *   backend-node/src/agents/contracts/alm-decision.contracts.ts
 *   backend-node/src/agents/contracts/risk-monitor.contracts.ts
 *   backend-node/src/agents/contracts/cfo-copilot.contracts.ts
 *   backend-node/src/agents/contracts/committee-report.contracts.ts
 */

// ─── Shared primitives ──────────────────────────────────────────────────────

export type Language = 'en' | 'es' | 'bilingual';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Deadline = '30d' | '60d' | '90d';
export type Owner = 'CFO' | 'ALM_COMMITTEE' | 'BOARD';
export type CommitteeType = 'board' | 'alm' | 'supervisory' | 'regulator';

// ─── Enum mirrors (from Prisma) ─────────────────────────────────────────────

export type AgentId =
  | 'ALM_DECISION'
  | 'COMMITTEE_REPORT'
  | 'RISK_MONITOR'
  | 'CFO_COPILOT'
  | 'STRESS_TESTING'
  | 'CAPITAL_OPTIMIZER'
  | 'REGULATORY_COMPLIANCE'
  | 'EXAM_PREP'
  | 'LOAN_PRICING'
  | 'DEPOSIT_STRATEGY'
  | 'PEER_INTELLIGENCE'
  | 'BOARD_NARRATIVE';

export type AgentRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type AgentTriggerKind =
  | 'UPLOAD'
  | 'SCHEDULE'
  | 'USER_QUERY'
  | 'API'
  | 'CHAIN';

export type AgentAuditStepKind =
  | 'RUN_STARTED'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'LLM_TURN'
  | 'CONTRACT_VALIDATION'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED';

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED';

export const AGENT_LABEL: Record<AgentId, string> = {
  ALM_DECISION: 'ALM Decision',
  COMMITTEE_REPORT: 'Committee Report',
  RISK_MONITOR: 'Risk Monitor',
  CFO_COPILOT: 'CFO Copilot',
  STRESS_TESTING: 'Stress Testing',
  CAPITAL_OPTIMIZER: 'Capital Optimizer',
  REGULATORY_COMPLIANCE: 'Regulatory Compliance',
  EXAM_PREP: 'Exam Prep',
  LOAN_PRICING: 'Loan Pricing',
  DEPOSIT_STRATEGY: 'Deposit Strategy',
  PEER_INTELLIGENCE: 'Peer Intelligence',
  BOARD_NARRATIVE: 'Board Narrative',
};

// ─── Run row ────────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  agentId: AgentId;
  agentVersion: string;
  promptVersion: string;
  institutionId: string | null;
  organizationId: string | null;
  triggeredByUserId: string | null;
  triggerKind: AgentTriggerKind;
  triggerRef: string | null;
  idempotencyKey: string;
  input: unknown;
  output: unknown | null;
  status: AgentRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  toolCallCount: number | null;
  llmTurnCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdCents: number | null;
  auditRootHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ─── ALM Decision ───────────────────────────────────────────────────────────

export interface HealthSnapshot {
  overall: number;
  capital: number;
  liquidity: number;
  rateRisk: number;
  credit: number;
  concentration: number;
  label: 'STRONG' | 'SATISFACTORY' | 'FAIR' | 'MARGINAL' | 'UNSATISFACTORY';
  trend: 'improving' | 'stable' | 'deteriorating';
}

export interface TopRisk {
  rank: 1 | 2 | 3 | 4 | 5;
  domain: string;
  /** severity × urgency × impact, 1–27 (Bible §01) */
  priorityScore: number;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  finding: string;
  findingEs: string;
  dollarImpact: number;
  /** percent of base NII expressed as decimal (6.2% → 6.2, not 0.062) */
  dollarImpactPct: number;
  regulatoryRef: string;
  toolsUsed: string[];
}

export interface DecisionQueueItem {
  priority: number;
  action: string;
  actionEs: string;
  expectedImpact: string;
  deadline: Deadline;
  owner: Owner;
  regulatoryRef: string;
  status: 'PENDING';
}

export interface ALMDecisionOutput {
  agentId: 'alm_decision';
  version: '2.0';
  runId: string;
  institutionId: string;
  timestamp: string;
  language: Language;
  healthSnapshot: HealthSnapshot;
  /** Always exactly 5 (Bible §01). */
  topRisks: TopRisk[];
  /** Always exactly 5 (Bible §01). */
  decisionQueue: DecisionQueueItem[];
  /** ≤ 600 words (Bible §01). */
  brief: string;
  /** ≤ 600 words. */
  briefEs: string;
  auditTraceId: string;
}

// ─── Risk Monitor ───────────────────────────────────────────────────────────

export type RiskAlertCategory =
  | 'liquidity'
  | 'rate_risk'
  | 'capital'
  | 'credit'
  | 'concentration'
  | 'deposit_flows'
  | 'peer_standing'
  | 'camel_drift';

export interface RiskAlert {
  category: RiskAlertCategory;
  severity: Severity;
  metric: string;
  currentValue: number;
  threshold: number;
  /** current − threshold. Negative means breach. */
  delta: number;
  trend: 'worsening' | 'stable' | 'improving';
  finding: string;
  findingEs: string;
  recommendation: string;
  regulatoryRef: string;
  /** ISO date (YYYY-MM-DD), not full timestamp. */
  deadline: string;
  dedupSeed: string;
}

export interface RiskMonitorOutput {
  agentId: 'risk_monitor';
  runId: string;
  institutionId: string;
  scanKind: 'daily' | 'weekly' | 'monthly' | 'realtime';
  alerts: RiskAlert[];
  alertCount: number;
  /** True if no CRITICAL/HIGH alerts — scheduler short-circuits notification. */
  quietRun: boolean;
}

// ─── Alert row (persisted) ──────────────────────────────────────────────────

export interface AgentAlertRecord {
  id: string;
  runId: string;
  institutionId: string;
  category: RiskAlertCategory;
  severity: Severity;
  status: AlertStatus;
  metric: string;
  currentValue: number;
  threshold: number;
  delta: number;
  finding: string;
  findingEs: string;
  recommendation: string;
  regulatoryRef: string;
  deadline: string;
  /** sha256(dedupSeed, institutionId) computed server-side. */
  dedupKey: string;
  /** Count of raw alerts collapsed under this dedupKey in the current window. */
  occurrenceCount?: number;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// ─── CFO Copilot ────────────────────────────────────────────────────────────

export interface CFOCopilotFollowup {
  en: string;
  es: string;
}

export interface CFOCopilotOutput {
  agentId: 'cfo_copilot';
  runId: string;
  institutionId: string;
  sessionId: string;
  language: 'en' | 'es';
  /** ≤ 300 words (Bible §04). */
  message: string;
  /** Exactly 4 (Bible §04). */
  followups: CFOCopilotFollowup[];
  toolsCalled: string[];
}

// ─── Committee Report ───────────────────────────────────────────────────────

export interface CommitteeRecommendation {
  index: number;
  action: string;
  owner: Owner;
  deadline: Deadline;
  expectedImpact: string;
  regulatoryRef: string;
}

export interface RegulatoryCalendarItem {
  dueDate: string;
  filing: string;
  status: 'READY' | 'IN_PREPARATION' | 'MISSING' | 'OVERDUE';
  owner: string;
  regulatoryRef: string;
}

export interface CommitteeReportOutput {
  agentId: 'committee_report';
  sourceRunId: string;
  committeeType: CommitteeType;
  language: Language;
  sections: {
    /** ≤ 150 words (Bible §02). */
    executiveSummary: string;
    financialPosition: string;
    interestRateRisk: string;
    creditConcentration: string;
    liquidityRisk: string;
    peerComparison: string;
    recommendations: CommitteeRecommendation[];
    regulatoryCalendar: RegulatoryCalendarItem[];
  };
  pdfPath: string;
  wordCount: number;
  bilingualEsPath?: string;
}

// ─── Audit trace ────────────────────────────────────────────────────────────

export interface AgentAuditStep {
  id: string;
  runId: string;
  stepNumber: number;
  stepKind: AgentAuditStepKind;
  toolName: string | null;
  toolInput: unknown | null;
  toolOutput: unknown | null;
  llmPrompt: string | null;
  llmOutput: string | null;
  durationMs: number | null;
  createdAt: string;
  /** sha256 of step content + prev hash — append-only integrity (Vol2 ADR-004). */
  contentHash: string;
  prevHash: string | null;
}

// ─── SSE event catalog ──────────────────────────────────────────────────────

export type AgentStreamEvent =
  | {
      type: 'agent:queued';
      runId: string;
      agentId: AgentId;
      position: number;
    }
  | { type: 'agent:started'; runId: string; agentId: AgentId; timestamp: string }
  | {
      type: 'agent:step';
      runId: string;
      stepNumber: number;
      stepKind: AgentAuditStepKind;
      toolName: string | null;
      pct: number;
    }
  | {
      type: 'agent:completed';
      runId: string;
      agentId: AgentId;
      summary: string;
      durationMs: number;
    }
  | {
      type: 'agent:failed';
      runId: string;
      agentId: AgentId;
      errorCode: string;
      errorMessage: string;
    }
  | {
      type: 'alert:new';
      alertId: string;
      severity: Severity;
      metric: string;
      finding: string;
    }
  | { type: 'alert:acknowledged'; alertId: string; acknowledgedBy: string }
  | {
      type: 'copilot:response';
      sessionId: string;
      content: string;
      followUps: CFOCopilotFollowup[];
    };

// ─── Trigger DTO ────────────────────────────────────────────────────────────

export interface AgentTriggerDto {
  agentId: AgentId;
  triggerKind: AgentTriggerKind;
  triggerRef?: string;
  params?: Record<string, unknown>;
}

// ─── API envelope ───────────────────────────────────────────────────────────

export interface PaginatedRuns {
  runs: AgentRun[];
  nextCursor: string | null;
}

export interface AlertAckDto {
  note?: string;
  status?: 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED';
}
