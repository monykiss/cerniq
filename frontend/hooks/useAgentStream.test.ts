import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAgentStream } from './useAgentStream';

let instances: FakeES[] = [];

class FakeES {
  url: string;
  readyState = 0;
  private namedListeners: Record<string, Set<(e: { data: string }) => void>> = {};
  onmessage: ((e: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  addEventListener(type: string, cb: (e: { data: string }) => void) {
    if (!this.namedListeners[type]) this.namedListeners[type] = new Set();
    this.namedListeners[type].add(cb);
  }

  removeEventListener(type: string, cb: (e: { data: string }) => void) {
    this.namedListeners[type]?.delete(cb);
  }

  close() {
    this.readyState = 2;
  }

  _emit(data: unknown) {
    const raw = JSON.stringify(data);
    const evt = { data: raw };
    const parsed = data as { type?: string };
    let handled = false;
    if (parsed.type && this.namedListeners[parsed.type]?.size) {
      for (const cb of this.namedListeners[parsed.type]) cb(evt);
      handled = true;
    }
    if (!handled && this.onmessage) this.onmessage(evt);
  }
}

beforeEach(() => {
  instances = [];
  vi.stubGlobal('EventSource', FakeES);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgentStream', () => {
  it('does not connect when institutionId is null', () => {
    renderHook(() => useAgentStream({ institutionId: null }));
    expect(instances).toHaveLength(0);
  });

  it('does not connect when disabled', () => {
    renderHook(() => useAgentStream({ institutionId: 'test', enabled: false }));
    expect(instances).toHaveLength(0);
  });

  it('connects when institutionId is provided', () => {
    renderHook(() => useAgentStream({ institutionId: 'inst-001' }));
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toContain('inst-001');
  });

  it('receives and stores events', async () => {
    const { result } = renderHook(() =>
      useAgentStream({ institutionId: 'inst-001' }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const es = instances[0];
    await act(async () => {
      es._emit({
        type: 'agent:started',
        runId: 'r1',
        agentId: 'ALM_DECISION',
        timestamp: '2026-04-15T10:00:00Z',
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.lastEvent?.type).toBe('agent:started');
  });

  it('respects maxEvents limit', async () => {
    const { result } = renderHook(() =>
      useAgentStream({ institutionId: 'inst-001', maxEvents: 2 }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const es = instances[0];
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        es._emit({
          type: 'agent:step',
          runId: 'r1',
          stepNumber: i,
          stepKind: 'TOOL_CALL',
          toolName: `tool${i}`,
          pct: i * 20,
        });
      });
    }

    expect(result.current.events.length).toBeLessThanOrEqual(2);
  });

  it('calls onEvent callback', async () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useAgentStream({ institutionId: 'inst-001', onEvent }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const es = instances[0];
    await act(async () => {
      es._emit({
        type: 'alert:new',
        alertId: 'a1',
        severity: 'CRITICAL',
        metric: 'LCR',
        finding: 'LCR below policy',
      });
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].type).toBe('alert:new');
  });

  it('resets state', async () => {
    const { result } = renderHook(() =>
      useAgentStream({ institutionId: 'inst-001' }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const es = instances[0];
    await act(async () => {
      es._emit({
        type: 'agent:completed',
        runId: 'r1',
        agentId: 'ALM_DECISION',
        summary: 'done',
        durationMs: 1000,
      });
    });

    expect(result.current.events).toHaveLength(1);

    act(() => result.current.reset());
    expect(result.current.events).toHaveLength(0);
    expect(result.current.lastEvent).toBeNull();
  });
});
