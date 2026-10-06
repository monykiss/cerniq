/**
 * Local read-model for agent runtime data (Blueprint §4).
 * Mirrors the Prisma AgentId/AgentRunStatus enums. All 12 agents aligned.
 */

export type AgentType =
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

export type AgentStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type StepType =
  | 'CONTEXT_FETCH'
  | 'SWARM_RUN'
  | 'TOOL_CALL'
  | 'LLM_REASONING'
  | 'OUTPUT_GENERATION'
  | 'NOTIFICATION';

export type Language = 'en' | 'es' | 'bilingual';

export interface AgentRunReadModel {
  id: string;
  institutionId: string;
  agentType: AgentType;
  status: AgentStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  modelVersion: string | null;
}

export interface AgentAuditLogReadModel {
  id: string;
  runId: string;
  stepNumber: number;
  stepType: StepType;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: Record<string, unknown> | null;
  llmPrompt: string | null;
  llmOutput: string | null;
  durationMs: number | null;
}

/** Severity of a trust violation. BLOCK = reject the run before persist. */
export type TrustSeverity = 'BLOCK' | 'WARN' | 'INFO';

export type TrustRule =
  | 'NUMBER_NOT_CITED'
  | 'PII_LEAK'
  | 'PROMPT_INJECTION_SUSPECTED'
  | 'HEDGE_LANGUAGE'
  | 'OUTPUT_SCHEMA_INVALID'
  | 'MISSING_BILINGUAL'
  | 'OVER_LENGTH';

export interface TrustViolation {
  rule: TrustRule;
  severity: TrustSeverity;
  message: string;
  /** Character offset into the text that triggered the violation, if applicable. */
  location?: { start: number; end: number };
  /** Structured evidence (matched number, redacted span, tool that should have cited). */
  evidence?: Record<string, unknown>;
}

export interface TrustVerdict {
  pass: boolean;
  violations: TrustViolation[];
  /** Counts by severity — cheap dashboard surface. */
  summary: { block: number; warn: number; info: number };
  /** Milliseconds spent validating. Logged as span attribute. */
  evaluatedInMs: number;
}
