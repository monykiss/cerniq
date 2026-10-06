// Frontend-shareable type barrel for the Agent Execution Layer.
//
// The frontend imports these types directly via the workspace path
// (`backend-node/src/agent-api/dto/api-types.ts` is referenced through the
// shared TS path map). We re-export from peer's contracts module so the
// frontend never reaches into `src/agents/contracts/*` directly — keeping
// the agent-api as the single public surface.
//
// Adding a type here is a contract change. Removing one breaks the frontend.

export type {
  AgentRunHandle,
  AgentTriggerKindLiteral,
} from '../../agents/runner/agent.types';

export type { ALMDecisionOutput } from '../../agents/contracts/alm-decision.contracts';
// Additional agent output types will be re-exported here as the peer
// finishes their contract schemas. Currently only ALM_DECISION is
// fully shipped — the other three contracts exist but their exported
// type names need to be verified before re-exporting.
export type {
  Language,
  Severity,
  Deadline,
  Owner,
  CommitteeType,
  BilingualString,
  ToolError,
} from '../../agents/contracts/common.contracts';

// Public response shapes the controllers actually emit. These are the wire
// format the frontend should code against.

export interface AgentRunListResponse {
  runs: Array<{
    id: string;
    agentId: string;
    status: string;
    triggerKind: string;
    institutionId: string | null;
    organizationId: string | null;
    durationMs: number | null;
    costUsdCents: number | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  // Cursor for the next page. Null when no more rows.
  nextCursor: string | null;
}

export interface AgentAlertListResponse {
  alerts: Array<{
    id: string;
    runId: string | null;
    agentId: string;
    severity: string;
    status: string;
    metric: string;
    finding: string;
    findingEs: string | null;
    recommendation: string;
    regulatoryRef: string | null;
    deadline: string | null;
    acknowledgedAt: string | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
  // Bloomberg-density summary for the header strip.
  summary: {
    open: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface AgentCostSummary {
  month: string; // YYYY-MM
  institutionId: string;
  totalRuns: number;
  totalCostUsdCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byAgent: Array<{
    agentId: string;
    runs: number;
    costUsdCents: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  // From the cost circuit breaker — informs the UI whether new runs will be
  // accepted or queued behind a budget gate.
  budget: {
    capUsdCents: number | null;
    remainingUsdCents: number | null;
    state: 'OK' | 'WARN' | 'BLOCKED';
  };
}

export interface AgentTraceExportJson {
  run: AgentRunListResponse['runs'][number] & {
    auditRootHash: string | null;
    promptVersion: string;
    agentVersion: string;
  };
  steps: Array<{
    stepIndex: number;
    stepKind: string;
    toolName: string | null;
    payload: unknown;
    prevHash: string | null;
    hash: string;
    durationMs: number | null;
    createdAt: string;
  }>;
  chain: { ok: true } | { ok: false; brokenAtIndex: number };
  generatedAt: string;
  // Hash of the full export (steps + run header). Regulators verify by
  // recomputing — see docs/ops/AGENT_API_CONTRACT.md for the algorithm.
  exportHash: string;
}

export type AgentStreamEventName =
  | 'agent.run.started'
  | 'agent.run.step'
  | 'agent.run.completed'
  | 'agent.run.failed';

export interface AgentStreamEvent<P = unknown> {
  type: AgentStreamEventName;
  payload: P;
  // Server-issued monotonic id used for SSE last-event-id resume.
  id: string;
}
