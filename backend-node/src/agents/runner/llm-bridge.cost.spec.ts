import { LlmBridgeService } from './llm-bridge.service';

// LlmBridgeService.computeCostUsdCents is the feed for the cost
// circuit breaker. Previously the runner never called any cost
// computation, so agentRun.costUsdCents was always NULL — which made
// AgentCostCircuitBreakerService.monthToDateSpend return 0 for every
// institution forever, silently disabling the budget safety control.
// This spec locks the math so the breaker gets a trustworthy signal.

describe('LlmBridgeService.computeCostUsdCents', () => {
  const compute = (
    inputTokens: number,
    outputTokens: number,
    env: Record<string, string | undefined> = {},
  ) =>
    LlmBridgeService.computeCostUsdCents(
      inputTokens,
      outputTokens,
      env as NodeJS.ProcessEnv,
    );

  it('returns 0 cents for a zero-token run', () => {
    expect(compute(0, 0)).toBe(0);
  });

  it('applies the default claude-opus-4-6 list price ($15 input / $75 output per 1M)', () => {
    // 1M input tokens at $15 = 1500 cents
    // 1M output tokens at $75 = 7500 cents
    // total = 9000 cents
    expect(compute(1_000_000, 1_000_000)).toBe(9000);
  });

  it('handles a realistic small run without precision drift', () => {
    // 5k input + 2k output at default rates
    //   5000/1e6 * 15  = 0.075 USD  = 7.5 cents
    //   2000/1e6 * 75  = 0.15  USD  = 15 cents
    //   total = 22.5 cents → rounds to 23 cents
    expect(compute(5_000, 2_000)).toBe(23);
  });

  it('honors LLM_INPUT_USD_PER_MILLION_TOKENS override', () => {
    // 1M input at $5 = 500 cents; 0 output
    expect(
      compute(1_000_000, 0, { LLM_INPUT_USD_PER_MILLION_TOKENS: '5' }),
    ).toBe(500);
  });

  it('honors LLM_OUTPUT_USD_PER_MILLION_TOKENS override', () => {
    // 0 input; 1M output at $25 = 2500 cents
    expect(
      compute(0, 1_000_000, { LLM_OUTPUT_USD_PER_MILLION_TOKENS: '25' }),
    ).toBe(2500);
  });

  it('ignores malformed rate overrides (falls back to default)', () => {
    // Non-numeric / negative rates silently disable the override
    // rather than crashing the run. The default ($15) applies.
    expect(
      compute(1_000_000, 0, { LLM_INPUT_USD_PER_MILLION_TOKENS: 'abc' }),
    ).toBe(1500);
    expect(
      compute(1_000_000, 0, { LLM_INPUT_USD_PER_MILLION_TOKENS: '-5' }),
    ).toBe(1500);
  });

  it('rounds to integer cents (Stripe invariant)', () => {
    // 100 tokens * $15 / 1M = 0.0015 USD = 0.15 cents → rounds to 0.
    expect(compute(100, 0)).toBe(0);
    // 500 tokens * $15 / 1M = 0.0075 USD = 0.75 cents → rounds to 1.
    expect(compute(500, 0)).toBe(1);
  });

  it('is deterministic across repeated invocations (no hidden state)', () => {
    const a = compute(12_345, 6_789);
    const b = compute(12_345, 6_789);
    expect(a).toBe(b);
  });
});
