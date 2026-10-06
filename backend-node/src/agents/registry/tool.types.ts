import { z } from 'zod';
import type { ToolError } from '../contracts/common.contracts';

// Tool call execution context. Every handler receives this so it can enforce
// tenant isolation, respect the global run timeout, and emit structured logs
// correlated with the enclosing agent run.
export interface ToolContext {
  readonly runId: string;
  readonly agentId: string;
  readonly institutionId: string | null;
  readonly organizationId: string | null;
  /// Abort when the run's deadline elapses — propagated to downstream HTTP /
  /// DB calls so they cancel instead of leaking work.
  readonly signal: AbortSignal;
}

export type ToolHandler<TIn, TOut> = (
  input: TIn,
  ctx: ToolContext,
) => Promise<TOut>;

// A tool is a fully-typed, Zod-validated unit of work the agent runtime can
// invoke. The `input` schema doubles as the JSON-schema published to the LLM
// for function-calling; the `output` schema guards against drift between
// service refactors and agent expectations.
export interface ToolDescriptor<
  TIn extends z.ZodTypeAny = z.ZodTypeAny,
  TOut extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /// Stable, snake-case identifier used by the LLM. Must match the Bible's
  /// tool registry exactly.
  readonly name: string;
  readonly description: string;
  readonly input: TIn;
  readonly output: TOut;
  readonly handler: ToolHandler<z.infer<TIn>, z.infer<TOut>>;
  /// Per-call budget. The runner aborts the call and surfaces TOOL_TIMEOUT
  /// if exceeded. Defaults to 10 000 ms.
  readonly timeoutMs?: number;
  /// When true, the runner will retry once on transient failures before
  /// surfacing the error to the LLM. Safe only for pure-read tools.
  readonly retryable?: boolean;
}

export type ToolInvocation = {
  name: string;
  inputJson: unknown;
};

export type ToolOutcome<T = unknown> =
  | {
      ok: true;
      data: T;
      durationMs: number;
      provenance: string[];
    }
  | (ToolError & { name: string });

// Type helper so producers can build a descriptor with full inference.
export function defineTool<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
  d: ToolDescriptor<TIn, TOut>,
): ToolDescriptor<TIn, TOut> {
  return d;
}
