import { Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import type { AgentType } from '../agent-trust/contracts';
import { AgentSpanFactory } from './agent-span.factory';
import { AGENT_STATUS } from './semantic-conventions';

/**
 * Event shapes from Blueprint §5.3 SSE schema. Defined locally so this module
 * stays independent of the peer-owned notifier implementation — the peer
 * {@link AgentNotifierService} emits objects matching these unions.
 */
export type AgentSseEvent =
  | {
      type: 'agent:started';
      runId: string;
      agentType: AgentType;
      institutionId: string;
    }
  | { type: 'agent:step'; runId: string; step: string; pct: number }
  | { type: 'agent:completed'; runId: string; summary: Record<string, unknown> }
  | { type: 'agent:failed'; runId: string; error: string };

/**
 * Converts the SSE event stream into OpenTelemetry spans. Keeps one open
 * root span per agent run and closes it on {@code completed} or {@code failed}.
 * Step events become span events (not child spans) — cheaper and still
 * visible on the Jaeger/Tempo timeline.
 *
 * Intentionally stateful: the span map is keyed by runId and lives for the
 * process lifetime. Runs longer than 1h are pruned (defensive — a run should
 * never last that long, but don't want to leak span handles).
 */
@Injectable()
export class SseToSpanBridge {
  private readonly logger = new Logger(SseToSpanBridge.name);
  private readonly openRuns = new Map<
    string,
    { span: Span; startedAt: number }
  >();
  private readonly MAX_OPEN_MS = 60 * 60 * 1000;

  constructor(private readonly spans: AgentSpanFactory) {}

  handle(event: AgentSseEvent): void {
    this.sweepStale();
    switch (event.type) {
      case 'agent:started': {
        const span = this.spans.startAgentRun({
          runId: event.runId,
          institutionId: event.institutionId,
          agentType: event.agentType,
        });
        span.setAttribute(AGENT_STATUS, 'RUNNING');
        this.openRuns.set(event.runId, { span, startedAt: Date.now() });
        return;
      }
      case 'agent:step': {
        const entry = this.openRuns.get(event.runId);
        if (!entry) return;
        entry.span.addEvent(`step:${event.step}`, {
          'agent.step.pct': event.pct,
        });
        return;
      }
      case 'agent:completed': {
        const entry = this.openRuns.get(event.runId);
        if (!entry) return;
        entry.span.setAttribute(AGENT_STATUS, 'COMPLETED');
        entry.span.addEvent('completed', flattenForEvent(event.summary));
        entry.span.setStatus({ code: SpanStatusCode.OK });
        entry.span.end();
        this.openRuns.delete(event.runId);
        return;
      }
      case 'agent:failed': {
        const entry = this.openRuns.get(event.runId);
        if (!entry) return;
        entry.span.setAttribute(AGENT_STATUS, 'FAILED');
        entry.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: event.error,
        });
        entry.span.end();
        this.openRuns.delete(event.runId);
        return;
      }
    }
  }

  /** For tests — returns whether a run is currently tracked. */
  has(runId: string): boolean {
    return this.openRuns.has(runId);
  }

  private sweepStale(): void {
    const now = Date.now();
    for (const [runId, entry] of this.openRuns) {
      if (now - entry.startedAt > this.MAX_OPEN_MS) {
        entry.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'sse span swept (stale)',
        });
        entry.span.end();
        this.openRuns.delete(runId);
        this.logger.warn(`sweeped stale span for run=${runId}`);
      }
    }
  }
}

function flattenForEvent(
  summary: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(summary)) {
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[`summary.${k}`] = v;
    } else {
      out[`summary.${k}`] = JSON.stringify(v);
    }
  }
  return out;
}
