import { AgentSpanFactory } from './agent-span.factory';
import { SseToSpanBridge } from './sse-to-span.bridge';

describe('SseToSpanBridge', () => {
  let bridge: SseToSpanBridge;

  beforeEach(() => {
    bridge = new SseToSpanBridge(new AgentSpanFactory());
  });

  it('opens a span on agent:started and closes on agent:completed', () => {
    bridge.handle({
      type: 'agent:started',
      runId: 'r1',
      agentType: 'ALM_DECISION',
      institutionId: 'i1',
    });
    expect(bridge.has('r1')).toBe(true);
    bridge.handle({
      type: 'agent:completed',
      runId: 'r1',
      summary: { risks: 3 },
    });
    expect(bridge.has('r1')).toBe(false);
  });

  it('closes the span on agent:failed too', () => {
    bridge.handle({
      type: 'agent:started',
      runId: 'r2',
      agentType: 'RISK_MONITOR',
      institutionId: 'i1',
    });
    bridge.handle({
      type: 'agent:failed',
      runId: 'r2',
      error: 'swarm_timeout',
    });
    expect(bridge.has('r2')).toBe(false);
  });

  it('ignores step events for unknown runs without throwing', () => {
    expect(() =>
      bridge.handle({
        type: 'agent:step',
        runId: 'unknown',
        step: 'swarm_run',
        pct: 30,
      }),
    ).not.toThrow();
  });

  it('records step events on the open span', () => {
    bridge.handle({
      type: 'agent:started',
      runId: 'r3',
      agentType: 'ALM_DECISION',
      institutionId: 'i1',
    });
    expect(() =>
      bridge.handle({
        type: 'agent:step',
        runId: 'r3',
        step: 'swarm_run',
        pct: 40,
      }),
    ).not.toThrow();
    bridge.handle({ type: 'agent:completed', runId: 'r3', summary: {} });
  });
});
