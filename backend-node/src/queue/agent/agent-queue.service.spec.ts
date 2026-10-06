import { AgentQueueService, type AgentJobInput } from './agent-queue.service';

function makeJob(overrides: Partial<AgentJobInput> = {}): AgentJobInput {
  return {
    agentId: 'ALM_DECISION',
    input: { institutionId: 'inst_1' },
    options: {
      institutionId: 'inst_1',
      idempotencyKey: `k_${Math.random().toString(36).slice(2)}`,
      triggerKind: 'API',
    },
    ...overrides,
  };
}

function buildService(
  overrides: {
    runDelay?: number;
    budgetAllowed?: boolean;
  } = {},
) {
  const runner = {
    run: jest.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                runId: 'r_1',
                status: 'SUCCEEDED',
                existed: false,
                durationMs: 10,
              }),
            overrides.runDelay ?? 0,
          ),
        ),
    ),
  };
  const costBreaker = {
    isAllowed: jest.fn().mockResolvedValue({
      allowed: overrides.budgetAllowed ?? true,
      state: 'OK',
      spentCents: 0,
      capCents: 10000,
    }),
  };
  const svc = new AgentQueueService(runner as any, costBreaker as any);
  return { svc, runner, costBreaker };
}

describe('AgentQueueService', () => {
  it('accepts a valid job and dispatches it', async () => {
    const { svc, runner } = buildService();
    const result = await svc.enqueue(makeJob());
    expect(result.accepted).toBe(true);
    expect(result.position).toBeDefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.run).toHaveBeenCalled();
  });

  it('rejects when budget is exceeded', async () => {
    const { svc, costBreaker } = buildService({ budgetAllowed: false });
    costBreaker.isAllowed.mockResolvedValue({
      allowed: false,
      state: 'BLOCKED',
      spentCents: 12000,
      capCents: 10000,
    });
    const result = await svc.enqueue(makeJob());
    expect(result.accepted).toBe(false);
    expect(result.rejectedReason).toBe('BUDGET_EXCEEDED');
  });

  it('rejects when queue is full (200 depth)', async () => {
    const { svc } = buildService({ runDelay: 60000 });
    (svc as any).concurrency = 1;
    // First job drains to processing. Remaining 200 fill the pending queue.
    for (let i = 0; i < 201; i++) {
      await svc.enqueue(makeJob());
    }
    const overflow = await svc.enqueue(makeJob());
    expect(overflow.accepted).toBe(false);
    expect(overflow.rejectedReason).toBe('QUEUE_FULL');
  });

  it('prioritizes RISK_MONITOR over API triggers', async () => {
    const { svc, runner } = buildService({ runDelay: 50 });
    (svc as any).concurrency = 1;
    const first = await svc.enqueue(makeJob());
    await new Promise((r) => setTimeout(r, 10));
    const apiJob = await svc.enqueue(makeJob({ agentId: 'CFO_COPILOT' }));
    const monitorJob = await svc.enqueue(makeJob({ agentId: 'RISK_MONITOR' }));
    expect(monitorJob.position).toBeLessThanOrEqual(apiJob.position!);
  });

  it('skips budget check when no institutionId', async () => {
    const { svc, costBreaker } = buildService();
    await svc.enqueue(
      makeJob({
        options: { idempotencyKey: 'k_1', institutionId: null } as any,
      }),
    );
    expect(costBreaker.isAllowed).not.toHaveBeenCalled();
  });

  it('reports accurate stats', async () => {
    const { svc } = buildService({ runDelay: 100 });
    await svc.enqueue(makeJob());
    const s = svc.stats;
    expect(s.concurrency).toBeGreaterThan(0);
    expect(typeof s.pending).toBe('number');
    expect(typeof s.processing).toBe('number');
  });

  // ── Concurrency env resolution ──────────────────────────────────
  // Guards against the parseInt trap: '100abc' silently became 100,
  // '0' silently became zero concurrency (which deadlocks the drain
  // loop because `while (processing < 0)` never runs), and '-5' had
  // the same deadlock shape. All invalid inputs now fall back to the
  // default with a warn log instead of corrupting runtime behavior.
  describe('resolveConcurrency', () => {
    const resolve = (env: Record<string, string | undefined>) =>
      AgentQueueService.resolveConcurrency(env as NodeJS.ProcessEnv);

    it('defaults to 5 when AGENT_WORKER_CONCURRENCY is unset', () => {
      expect(resolve({})).toBe(5);
    });

    it('honors a valid positive integer', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '10' })).toBe(10);
    });

    it('defaults on zero (would deadlock drain loop)', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '0' })).toBe(5);
    });

    it('defaults on negative values', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '-5' })).toBe(5);
    });

    it('defaults on fractional values (no silent floor)', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '5.5' })).toBe(5);
    });

    it('defaults on trailing-garbage strings (no parseInt silent-accept)', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '100abc' })).toBe(5);
    });

    it('defaults on non-numeric strings', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: 'abc' })).toBe(5);
    });

    it('defaults when above upper bound (50)', () => {
      expect(resolve({ AGENT_WORKER_CONCURRENCY: '51' })).toBe(5);
    });
  });
});
