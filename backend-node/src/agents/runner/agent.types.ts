import type { z } from 'zod';

export type AgentIdLiteral =
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

export type AgentTriggerKindLiteral =
  | 'UPLOAD'
  | 'SCHEDULE'
  | 'USER_QUERY'
  | 'API'
  | 'CHAIN';

export type AgentAuditStepKindLiteral =
  | 'RUN_STARTED'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'LLM_TURN'
  | 'CONTRACT_VALIDATION'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED';

export interface AgentRunHandle {
  runId: string;
  agentId: string;
  institutionId: string | null;
  replay: boolean;
  _nextStepIndex: number;
}

export interface AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly systemPrompt: string;
  readonly allowedTools: ReadonlySet<string>;
  readonly outputSchema: TOutput;
  readonly runTimeoutMs: number;
  readonly maxTurns: number;
  buildUserMessage(input: unknown): string;
}

export interface AgentToolMeta {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  permissions?: string[];
  provenanceTag?: string;
}

export type ToolOk<T> = {
  ok: true;
  data: T;
  provenance: string[];
  durationMs: number;
};
export type ToolErr = {
  ok: false;
  code:
    | 'TOOL_TIMEOUT'
    | 'TOOL_UNAVAILABLE'
    | 'TOOL_INPUT_INVALID'
    | 'TOOL_OUTPUT_INVALID'
    | 'TOOL_INTERNAL_ERROR'
    | 'TOOL_FORBIDDEN'
    | 'TOOL_NOT_FOUND';
  message: string;
  hint?: string;
  durationMs: number;
};
export type ToolResult<T = unknown> = ToolOk<T> | ToolErr;

export interface ToolDispatchContext {
  runHandle: AgentRunHandle;
  userRoles?: string[];
  institutionId?: string | null;
  organizationId?: string | null;
}

export type ToolHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: ToolDispatchContext,
) => Promise<O> | O;

export interface RegisteredTool {
  meta: AgentToolMeta;
  handler: ToolHandler;
}
