import { Injectable, Logger } from '@nestjs/common';
import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  AGENT_RUN_ID,
  AGENT_TYPE,
  INSTITUTION_ID,
  SPAN_NAMES,
  TOOL_LATENCY_MS,
  TOOL_NAME,
  TOOL_STATUS,
  TRUST_BLOCK_COUNT,
  TRUST_EVAL_MS,
  TRUST_PASS,
  TRUST_VIOLATIONS,
  TRUST_WARN_COUNT,
} from './semantic-conventions';
import type { AgentType } from '../agent-trust/contracts';
import type { TrustVerdict } from '../agent-trust/contracts';

/**
 * Factory that creates correctly-attributed OTel spans for agent-runtime
 * events. Wrappers accept a callback and automatically close the span on
 * success, record errors, and propagate context.
 *
 * Dependency injection note: we don't inject a tracer — {@link trace.getTracer}
 * is cheap (memoised inside the SDK) and keeps this class thin.
 */
@Injectable()
export class AgentSpanFactory {
  private readonly logger = new Logger(AgentSpanFactory.name);
  private readonly tracer: Tracer = trace.getTracer('cerniq-agent', '1.0.0');

  /** Root span for an entire agent run. Caller owns end(). */
  startAgentRun(ctx: {
    runId: string;
    institutionId: string;
    agentType: AgentType;
    attributes?: Attributes;
  }): Span {
    return this.tracer.startSpan(SPAN_NAMES.AGENT_RUN, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AGENT_RUN_ID]: ctx.runId,
        [INSTITUTION_ID]: ctx.institutionId,
        [AGENT_TYPE]: ctx.agentType,
        ...ctx.attributes,
      },
    });
  }

  /**
   * Wrap a tool call. Returns whatever the callback returns and records
   * latency + status. Any thrown error is recorded and re-thrown.
   */
  async withToolCall<T>(
    toolName: string,
    fn: () => Promise<T>,
    extra?: Attributes,
  ): Promise<T> {
    const span = this.tracer.startSpan(SPAN_NAMES.TOOL_CALL, {
      kind: SpanKind.INTERNAL,
      attributes: { [TOOL_NAME]: toolName, ...extra },
    });
    const started = Date.now();
    try {
      const out = await fn();
      span.setAttribute(TOOL_LATENCY_MS, Date.now() - started);
      span.setAttribute(TOOL_STATUS, 'ok');
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.setAttribute(TOOL_LATENCY_MS, Date.now() - started);
      span.setAttribute(TOOL_STATUS, 'error');
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  }

  /** Record a completed trust evaluation as a short span with verdict attributes. */
  recordTrustVerdict(parent: Span | null, verdict: TrustVerdict): void {
    const span = this.tracer.startSpan(
      SPAN_NAMES.TRUST_EVALUATE,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [TRUST_PASS]: verdict.pass,
          [TRUST_BLOCK_COUNT]: verdict.summary.block,
          [TRUST_WARN_COUNT]: verdict.summary.warn,
          [TRUST_EVAL_MS]: verdict.evaluatedInMs,
          [TRUST_VIOLATIONS]: verdict.violations.map((v) => v.rule),
        },
      },
      parent ? trace.setSpan(otelContext.active(), parent) : undefined,
    );
    if (!verdict.pass) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'trust verdict BLOCK',
      });
    }
    span.end();
  }
}
