import { AgentTenantStreamController } from '../agent-tenant-stream.controller';
import { AGENT_EVENT } from '../../agents/runner/agent-event-bus.service';

describe('AgentTenantStreamController', () => {
  let controller: AgentTenantStreamController;
  let mockBus: any;
  let mockPrisma: any;
  let busHandlers: Map<
    string,
    Array<(event: string, payload: unknown) => void>
  >;

  const INST_ID = 'inst-001';

  beforeEach(() => {
    busHandlers = new Map();
    mockBus = {
      onAny: jest.fn((handler: any) => {
        let list = busHandlers.get('*');
        if (!list) {
          list = [];
          busHandlers.set('*', list);
        }
        list.push(handler);
        return () => {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        };
      }),
    };
    mockPrisma = {
      agentRun: {
        findUnique: jest.fn(),
      },
    };
    controller = new AgentTenantStreamController(mockBus, mockPrisma);
  });

  it('returns an Observable that completes on RUN_COMPLETED', (done) => {
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      institutionId: INST_ID,
    });

    const obs = controller.stream(INST_ID, { runId: 'run-1' });
    const events: any[] = [];

    obs.subscribe({
      next: (ev) => events.push(ev),
      complete: () => {
        // Should have received at least the RUN_COMPLETED event.
        const completed = events.find(
          (e) => e.type === AGENT_EVENT.RUN_COMPLETED,
        );
        expect(completed).toBeDefined();
        done();
      },
    });

    // Simulate the bus emitting events. The controller subscribes with
    // onAny which captures a handler — invoke it directly.
    const handlers = busHandlers.get('*') ?? [];
    expect(handlers.length).toBeGreaterThan(0);

    // Step event
    handlers[0](AGENT_EVENT.RUN_STEP, { runId: 'run-1', kind: 'tool_result' });
    // Completed event (triggers complete for single-run subscribers)
    handlers[0](AGENT_EVENT.RUN_COMPLETED, { runId: 'run-1' });
  });

  it('filters out events from a different run', (done) => {
    mockPrisma.agentRun.findUnique.mockImplementation(
      (args: { where: { id: string } }) =>
        Promise.resolve(
          args.where.id === 'run-1'
            ? { institutionId: INST_ID }
            : { institutionId: 'other-inst' },
        ),
    );

    const obs = controller.stream(INST_ID, {});
    const events: any[] = [];

    obs.subscribe({
      next: (ev) => {
        // Ping heartbeats are informational — skip them.
        if (ev.type !== 'ping') events.push(ev);
      },
    });

    const handlers = busHandlers.get('*') ?? [];

    // Emit for a run NOT belonging to this institution.
    handlers[0](AGENT_EVENT.RUN_STARTED, { runId: 'run-other' });

    // Small delay to let the async resolution settle.
    setTimeout(() => {
      expect(events.length).toBe(0);
      done();
    }, 50);
  });
});
