import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

// In-process pub-sub for agent lifecycle events. The realtime gateway
// subscribes in its own module via `agentEventBus.on(...)` — no external
// dependency (`@nestjs/event-emitter` is deliberately avoided to keep the
// agents module self-contained and its test surface tiny).
//
// Events are advisory: losing one does not compromise run correctness
// (state lives in Postgres + the audit chain). This bus exists purely for
// real-time UX, so we use the Node EventEmitter that already ships with
// the runtime rather than adding a dep for at-most-once delivery.

export const AGENT_EVENT = {
  RUN_STARTED: 'agent.run.started',
  RUN_STEP: 'agent.run.step',
  RUN_COMPLETED: 'agent.run.completed',
  RUN_FAILED: 'agent.run.failed',
} as const;

export type AgentEventName = (typeof AGENT_EVENT)[keyof typeof AGENT_EVENT];

@Injectable()
export class AgentEventBusService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Agent lifecycle can fan out to SSE, Sentry breadcrumbs, and dev
    // logging simultaneously. 50 listeners keeps us well above realistic
    // fan-out without hiding leaks under the default 10-cap warning.
    this.emitter.setMaxListeners(50);
  }

  emit(event: AgentEventName, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  on(event: AgentEventName, handler: (payload: unknown) => void): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  /// Fan-out to a single caller for all agent events. Useful for SSE
  /// endpoints that want to forward every step for a given runId.
  onAny(
    handler: (event: AgentEventName, payload: unknown) => void,
  ): () => void {
    const wrap = (event: AgentEventName) => (p: unknown) => handler(event, p);
    const offs = Object.values(AGENT_EVENT).map((e) => {
      const h = wrap(e);
      this.emitter.on(e, h);
      return () => this.emitter.off(e, h);
    });
    return () => offs.forEach((off) => off());
  }
}
