'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentStreamEvent } from '@/types/agents';
import { agentStreamUrl } from '@/lib/agents-api';

/**
 * Subscribe to the per-institution SSE event bus.
 *
 * Wraps EventSource directly rather than `useSSEStream` because this stream
 * is JSON-event-typed (not token text) and uses named SSE events, not
 * un-typed `onmessage` frames. The hook keeps a bounded rolling buffer
 * (default 50) so a long-open stream cannot grow the React state
 * unboundedly.
 *
 * Production topology (Vol2 §Deployment + ADR-005): backend publishes to a
 * Redis channel; any NestJS pod holding an SSE connection for that
 * institution fan-outs to its clients. The frontend stays naive — one
 * EventSource to `/stream`.
 */

export interface UseAgentStreamOptions {
  institutionId: string | null;
  /** Max events retained in memory (default 50). Older events dropped FIFO. */
  maxEvents?: number;
  /** Optional event-type filter. */
  filter?: AgentStreamEvent['type'] | AgentStreamEvent['type'][];
  /** Called for every event. Prefer this over reading `events` for perf. */
  onEvent?: (event: AgentStreamEvent) => void;
  /** Pause/resume (default true = subscribed). */
  enabled?: boolean;
}

export interface UseAgentStreamState {
  events: AgentStreamEvent[];
  lastEvent: AgentStreamEvent | null;
  isConnected: boolean;
  error: string | null;
  reset: () => void;
}

const EVENT_TYPES: ReadonlyArray<AgentStreamEvent['type']> = [
  'agent:queued',
  'agent:started',
  'agent:step',
  'agent:completed',
  'agent:failed',
  'alert:new',
  'alert:acknowledged',
  'copilot:response',
];

export function useAgentStream(
  options: UseAgentStreamOptions,
): UseAgentStreamState {
  const {
    institutionId,
    maxEvents = 50,
    filter,
    onEvent,
    enabled = true,
  } = options;

  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<AgentStreamEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  // Keep the ref in sync with the latest callback. Doing this in an
  // effect (rather than during render body) satisfies the hooks lint
  // rule that forbids ref mutations during render — commit-phase update
  // is semantically equivalent since the ref is only dereferenced inside
  // event handlers that run after the commit.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const filterKey = Array.isArray(filter)
    ? filter.join('|')
    : filter ?? '';

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setEvents([]);
    setLastEvent(null);
    setIsConnected(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!institutionId || !enabled) {
      esRef.current?.close();
      esRef.current = null;
      // Intentional: the disabled-or-no-institution branch must reset the
      // connected flag synchronously so consumers of `isConnected` see
      // the disconnected state on the very next render. The cascading-
      // render concern doesn't apply here because this only fires when
      // the gating props flip, not on every effect run.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConnected(false);
      return;
    }

    const es = new EventSource(agentStreamUrl(institutionId), {
      withCredentials: true,
    });
    esRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onerror = () => {
      setIsConnected(false);
      // Browser auto-reconnects. We only surface fatal close() via onerror
      // when readyState === CLOSED.
      if (es.readyState === EventSource.CLOSED) {
        setError('stream closed');
      }
    };

    const handleEvent = (raw: MessageEvent) => {
      const filters = filterKey
        ? (filterKey.split('|') as AgentStreamEvent['type'][])
        : null;
      let parsed: AgentStreamEvent | null = null;
      try {
        parsed = JSON.parse(raw.data) as AgentStreamEvent;
      } catch {
        return;
      }
      if (!parsed || !parsed.type) return;
      if (filters && !filters.includes(parsed.type)) return;

      setLastEvent(parsed);
      setEvents((prev) => {
        const next = prev.length >= maxEvents ? prev.slice(1) : prev;
        return [...next, parsed!];
      });
      onEventRef.current?.(parsed);
    };

    for (const t of EVENT_TYPES) {
      es.addEventListener(t, handleEvent as EventListener);
    }
    // Some servers emit unnamed `message` frames too.
    es.onmessage = handleEvent;

    return () => {
      for (const t of EVENT_TYPES) {
        es.removeEventListener(t, handleEvent as EventListener);
      }
      es.close();
      esRef.current = null;
    };
  }, [institutionId, enabled, maxEvents, filterKey]);

  return { events, lastEvent, isConnected, error, reset };
}
