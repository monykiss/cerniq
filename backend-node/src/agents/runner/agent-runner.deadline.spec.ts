import { z } from 'zod';
import {
  AgentRunnerService,
  resolveRunTimeoutMs,
} from './agent-runner.service';

// Mock the agent definition registry so the spec can inject a minimal
// fake definition without pulling in the full 12-agent catalog.
jest.mock('../definitions/registry', () => ({
  resolveAgentDefinition: jest.fn(),
}));
import { resolveAgentDefinition } from '../definitions/registry';

const mockedResolve = resolveAgentDefinition as jest.MockedFunction<
  typeof resolveAgentDefinition
>;

describe('resolveRunTimeoutMs', () => {
  it('defaults to 300_000ms when AGENT_RUN_TIMEOUT_MS is unset', () => {
    expect(resolveRunTimeoutMs({} as NodeJS.ProcessEnv)).toBe(300_000);
  });

  it('honors a valid integer override', () => {
    expect(
      resolveRunTimeoutMs({
        AGENT_RUN_TIMEOUT_MS: '60000',
      } as NodeJS.ProcessEnv),
    ).toBe(60_000);
  });

  it('defaults on values below the 1000ms floor (too aggressive)', () => {
    expect(
      resolveRunTimeoutMs({
        AGENT_RUN_TIMEOUT_MS: '100',
      } as NodeJS.ProcessEnv),
    ).toBe(300_000);
  });

  it('defaults on non-numeric / fractional / empty strings', () => {
    expect(
      resolveRunTimeoutMs({ AGENT_RUN_TIMEOUT_MS: 'abc' } as NodeJS.ProcessEnv),
    ).toBe(300_000);
    expect(
      resolveRunTimeoutMs({
        AGENT_RUN_TIMEOUT_MS: '1000.5',
      } as NodeJS.ProcessEnv),
    ).toBe(300_000);
    expect(
      resolveRunTimeoutMs({ AGENT_RUN_TIMEOUT_MS: '' } as NodeJS.ProcessEnv),
    ).toBe(300_000);
  });
});

// Integration spec: exercise the _execute deadline plumbing end-to-end
// with a hanging tool. Verifies the runner (1) aborts the run on
// deadline, (2) reports TIMED_OUT with errorCode RUN_TIMEOUT, and
// (3) persists via AgentRunService.timedOut rather than .fail.
describe('AgentRunnerService deadline', () => {
  // Minimal fake definition whose tool invocation will hang until the
  // run-scoped AbortSignal fires. This proves the signal is live.
  const HangingInput = z.object({});
  const OutputShape = z.object({ ok: z.boolean() });

  function makeFakeDefinition() {
    return {
      agentVersion: 'v1',
      promptVersion: 'p1',
      systemPrompt: 'sys',
      allowedTools: new Set<string>(['hang']),
      maxTurns: 5,
      outputSchema: OutputShape,
      buildUserMessage: (_i: unknown) => 'go',
      inputSchema: HangingInput,
    } as any;
  }

  function makeMocks(
    opts: {
      onToolInvoke?: (signal: AbortSignal) => Promise<unknown>;
    } = {},
  ) {
    const runs = {
      startRun: jest.fn().mockResolvedValue({
        runId: 'run-1',
        agentId: 'ALM_DECISION',
        replay: false,
        _nextStepIndex: 0,
      }),
      markRunning: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
      timedOut: jest.fn().mockResolvedValue(undefined),
      getRun: jest.fn(),
    };
    const audit = {
      append: jest.fn().mockImplementation(async () => ({ hash: 'h' })),
    };
    const tools = {
      describeForLLM: jest.fn().mockReturnValue([]),
      invoke: jest
        .fn()
        .mockImplementation(
          async (_name: string, _input: unknown, ctx: any) => {
            if (opts.onToolInvoke) return opts.onToolInvoke(ctx.signal);
            return { ok: true, data: {}, durationMs: 0, provenance: [] };
          },
        ),
    };
    const llm = {
      turn: jest.fn().mockResolvedValue({
        stopReason: 'tool_use',
        text: '',
        toolCalls: [{ id: 't1', name: 'hang', input: {} }],
        inputTokens: 1,
        outputTokens: 1,
      }),
    };
    const events = { emit: jest.fn() };
    return { runs, audit, tools, llm, events };
  }

  const makeRunner = (m: ReturnType<typeof makeMocks>) =>
    new AgentRunnerService(
      m.runs as any,
      m.audit as any,
      m.tools as any,
      m.llm as any,
      m.events as any,
    );

  beforeEach(() => {
    mockedResolve.mockReturnValue(makeFakeDefinition());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('surfaces TIMED_OUT when a tool hangs past the deadline', async () => {
    // 1 second deadline, well below jest's default 5s test timeout.
    const prevEnv = process.env.AGENT_RUN_TIMEOUT_MS;
    process.env.AGENT_RUN_TIMEOUT_MS = '1000';

    // Tool hangs until its per-call signal (which chains to the
    // run-scoped signal via ToolRegistryService) aborts. In this spec
    // we receive the signal directly from the runner.
    const hangingTool = (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('__TOOL_TIMEOUT__')),
          {
            once: true,
          },
        );
      });

    const m = makeMocks({ onToolInvoke: hangingTool });
    const svc = makeRunner(m);

    const resultPromise = svc.run({
      agentId: 'ALM_DECISION',
      idempotencyKey: 'k1',
      institutionId: 'inst-1',
      input: {},
    });

    // Give the LLM turn a microtask to issue the tool call; then
    // advance past the 1 s deadline to trigger the abort.
    await Promise.resolve();
    // Use real timers for this spec — fake-timer interleaving with
    // async microtasks is subtle and the 1 s wait is cheap.
    const result = await resultPromise;

    expect(result.status).toBe('TIMED_OUT');
    expect(result.errorCode).toBe('RUN_TIMEOUT');
    expect(m.runs.timedOut).toHaveBeenCalledTimes(1);
    expect(m.runs.fail).not.toHaveBeenCalled();

    if (prevEnv === undefined) delete process.env.AGENT_RUN_TIMEOUT_MS;
    else process.env.AGENT_RUN_TIMEOUT_MS = prevEnv;
  }, 10_000);

  it('never hits the deadline on a fast successful run', async () => {
    const prevEnv = process.env.AGENT_RUN_TIMEOUT_MS;
    process.env.AGENT_RUN_TIMEOUT_MS = '60000';

    const m = makeMocks();
    // LLM returns an end_turn immediately with a schema-valid payload.
    m.llm.turn.mockResolvedValue({
      stopReason: 'end_turn',
      text: '{"ok":true}',
      toolCalls: [],
      inputTokens: 1,
      outputTokens: 1,
    });
    const svc = makeRunner(m);

    const result = await svc.run({
      agentId: 'ALM_DECISION',
      idempotencyKey: 'k2',
      institutionId: 'inst-1',
      input: {},
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(m.runs.complete).toHaveBeenCalledTimes(1);
    expect(m.runs.timedOut).not.toHaveBeenCalled();
    expect(m.runs.fail).not.toHaveBeenCalled();

    if (prevEnv === undefined) delete process.env.AGENT_RUN_TIMEOUT_MS;
    else process.env.AGENT_RUN_TIMEOUT_MS = prevEnv;
  });

  // ── Cost accounting passthrough ────────────────────────────────
  // The cost circuit breaker sums `agentRun.costUsdCents`. Before
  // this pass, the runner never wrote that column — every run
  // persisted null, so month-to-date spend was always $0 and the
  // breaker never tripped. These specs lock the passthrough on both
  // the success path (runs.complete) and the timeout path
  // (runs.timedOut) so regressions are caught at the contract level.
  it('persists costUsdCents on successful completion', async () => {
    const m = makeMocks();
    m.llm.turn.mockResolvedValue({
      stopReason: 'end_turn',
      text: '{"ok":true}',
      toolCalls: [],
      inputTokens: 1000,
      outputTokens: 500,
    });
    const svc = makeRunner(m);

    await svc.run({
      agentId: 'ALM_DECISION',
      idempotencyKey: 'k_cost_ok',
      institutionId: 'inst-1',
      input: {},
    });

    expect(m.runs.complete).toHaveBeenCalledTimes(1);
    const completeArgs = m.runs.complete.mock.calls[0][1];
    expect(completeArgs.inputTokens).toBe(1000);
    expect(completeArgs.outputTokens).toBe(500);
    // 1000 input @ $15/1M = 1.5 cents; 500 output @ $75/1M = 3.75 cents
    // total = 5.25 cents → rounds to 5.
    expect(completeArgs.costUsdCents).toBe(5);
  });

  it('aborts an in-flight LLM call when the run deadline fires (not just tool calls)', async () => {
    // Before D16 the runner only cancelled in-flight TOOL calls when
    // the deadline fired — an LLM turn stuck on the network would
    // outlive the deadline up to the Anthropic SDK's default 10-min
    // timeout. This spec proves the run-scoped signal now reaches
    // the LLM fetch by asserting that a hanging LLM turn (no tool
    // calls even emitted) surfaces TIMED_OUT, not EXECUTION_FAILED.
    const prevEnv = process.env.AGENT_RUN_TIMEOUT_MS;
    process.env.AGENT_RUN_TIMEOUT_MS = '1000';

    const m = makeMocks();
    m.llm.turn.mockImplementation(
      (req: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          // Mirror the SDK contract: reject with AbortError when the
          // signal fires. The runner's catch-path checks
          // runAbort.signal.aborted to distinguish TIMED_OUT.
          req.signal?.addEventListener(
            'abort',
            () => {
              const err = new Error('Request was aborted.');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true },
          );
        }),
    );
    const svc = makeRunner(m);

    const result = await svc.run({
      agentId: 'ALM_DECISION',
      idempotencyKey: 'k_llm_hang',
      institutionId: 'inst-1',
      input: {},
    });

    expect(result.status).toBe('TIMED_OUT');
    expect(result.errorCode).toBe('RUN_TIMEOUT');
    expect(m.runs.timedOut).toHaveBeenCalledTimes(1);
    expect(m.runs.fail).not.toHaveBeenCalled();
    // LLM was invoked once and received an AbortSignal argument.
    expect(m.llm.turn).toHaveBeenCalledTimes(1);
    const turnArg = m.llm.turn.mock.calls[0][0];
    expect(turnArg.signal).toBeInstanceOf(AbortSignal);

    if (prevEnv === undefined) delete process.env.AGENT_RUN_TIMEOUT_MS;
    else process.env.AGENT_RUN_TIMEOUT_MS = prevEnv;
  }, 10_000);

  it('persists costUsdCents even when a run times out', async () => {
    const prevEnv = process.env.AGENT_RUN_TIMEOUT_MS;
    process.env.AGENT_RUN_TIMEOUT_MS = '1000';

    const m = makeMocks({
      onToolInvoke: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('__TOOL_TIMEOUT__')),
            { once: true },
          );
        }),
    });
    // Stub the LLM turn to report realistic token usage before the
    // tool hangs — proves we capture cost for whatever work happened
    // pre-deadline.
    m.llm.turn.mockResolvedValue({
      stopReason: 'tool_use',
      text: '',
      toolCalls: [{ id: 't1', name: 'hang', input: {} }],
      inputTokens: 2000,
      outputTokens: 300,
    });
    const svc = makeRunner(m);

    await svc.run({
      agentId: 'ALM_DECISION',
      idempotencyKey: 'k_cost_timeout',
      institutionId: 'inst-1',
      input: {},
    });

    expect(m.runs.timedOut).toHaveBeenCalledTimes(1);
    const timedOutArgs = m.runs.timedOut.mock.calls[0][1];
    expect(timedOutArgs.inputTokens).toBe(2000);
    expect(timedOutArgs.outputTokens).toBe(300);
    // 2000 @ $15/1M = 3 cents; 300 @ $75/1M = 2.25 cents; total 5.25 → 5
    expect(timedOutArgs.costUsdCents).toBe(5);

    if (prevEnv === undefined) delete process.env.AGENT_RUN_TIMEOUT_MS;
    else process.env.AGENT_RUN_TIMEOUT_MS = prevEnv;
  }, 10_000);
});
