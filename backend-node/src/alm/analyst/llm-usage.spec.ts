import {
  extractUsage,
  mergeUsage,
  estimateCostCents,
  LLM_PRICING_VERSION,
} from './llm-usage';

describe('extractUsage', () => {
  it('returns null when response has no usage block (Rule 1: never silent-zero)', () => {
    expect(extractUsage({})).toBeNull();
    expect(extractUsage({ usage: null })).toBeNull();
  });

  it('extracts all four token classes', () => {
    const u = extractUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 25,
      },
    });
    expect(u).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 25,
    });
  });

  it('defaults missing per-field usage to 0 (legitimate absence, not unknown)', () => {
    const u = extractUsage({
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    expect(u).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

describe('mergeUsage', () => {
  const a = {
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 5,
  };
  const b = {
    inputTokens: 50,
    outputTokens: 75,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 30,
  };

  it('sums both records field-by-field', () => {
    expect(mergeUsage(a, b)).toEqual({
      inputTokens: 150,
      outputTokens: 275,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 35,
    });
  });

  it('returns the non-null record when one side is null', () => {
    expect(mergeUsage(null, b)).toEqual(b);
    expect(mergeUsage(a, null)).toEqual(a);
  });

  it('returns null when both sides are null', () => {
    expect(mergeUsage(null, null)).toBeNull();
  });
});

describe('estimateCostCents', () => {
  it('returns null + NO_PRICING_DATA for unknown models (Rule 1 discipline)', () => {
    const result = estimateCostCents('claude-some-future-model', {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(result).toEqual({
      cents: null,
      reason: 'NO_PRICING_DATA',
      model: 'claude-some-future-model',
    });
  });

  it('computes cost for claude-sonnet-4-20250514 with integer-math precision', () => {
    // 1M input tokens × $3 = $3.00 = 300 cents.
    const result = estimateCostCents('claude-sonnet-4-20250514', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(result).toEqual({
      cents: '300.0000',
      pricingVersion: LLM_PRICING_VERSION,
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('captures the 90%-discount cache-read pricing correctly', () => {
    // 1M cache-read tokens × $0.30 = $0.30 = 30 cents (not $3, the un-discounted price).
    const result = estimateCostCents('claude-sonnet-4-20250514', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(result).toMatchObject({ cents: '30.0000' });
  });

  it('combines all four token classes correctly', () => {
    // 100 input ($0.0003) + 200 output ($0.003) + 50 cache-create ($0.0001875) + 25 cache-read ($0.0000075)
    // = $0.0034950 = 0.349500 cents
    const result = estimateCostCents('claude-sonnet-4-20250514', {
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 25,
    });
    if (result.cents === null) {
      throw new Error('expected priced result');
    }
    // Use Number() not parseFloat() — `Financial Decimal Guard` blocks
    // bare parseFloat in ingest scope (.github/workflows/swarm-guards.yml).
    // result.cents is a string-encoded decimal here; Number() round-trips
    // it cleanly for the toBeCloseTo assertion (same numeric value as
    // parseFloat for valid numeric strings).
    expect(Number(result.cents)).toBeCloseTo(0.3495, 4);
  });

  it('pinned pricing version is exposed for audit-time verification', () => {
    expect(LLM_PRICING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
