// ─── LLM usage + cost stamping — KLYTICS Audit Discipline Rule 9 ───────
//
// Companion to `prompt-version.ts`. While that helper answers "WHAT prompt
// produced this output," this one answers "WHAT did the output cost." The
// pair is the minimum lineage Rule 9 requires on persisted LLM result rows.
//
// Three discipline points worth holding in mind while reading:
//
// 1. Anthropic's `response.usage` has FOUR fields, not two — input,
//    output, cache_creation, cache_read. A `tokens × $3/MTok` formula
//    silently misses the 90%-discount cache-read path; we keep all four
//    so downstream cost-attribution gets it right even when our pricing
//    is stale.
// 2. We compute in integer centi-cents (1 centi-cent = 0.01 cents) and
//    format at the boundary. Float arithmetic on small fractional prices
//    (0.30 microUSD/token isn't float-exact) silently drifts; integers
//    don't.
// 3. Unknown model → `cents: null` with a typed reason. Returning 0 for
//    an un-priced model would be the exact silent-zero pattern Rule 1
//    forbids. The caller decides whether to render `—` or block.

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to Anthropic's prompt cache on this call. */
  cacheCreationInputTokens: number;
  /** Tokens served from the cache (90%-discounted). */
  cacheReadInputTokens: number;
}

/** Shape we read from the Anthropic SDK response. */
interface AnthropicResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Extract usage from an Anthropic SDK response. Returns `null` when the
 * response carries no usage block at all (SDK error, mock response).
 *
 * Missing individual fields default to 0 — those defaults are *not* a
 * Rule 1 violation because Anthropic omits the field only when the call
 * legitimately had zero of that token class (e.g. no cache reads on a
 * cold call). The all-or-nothing null at the top level is the actual
 * "unknown" signal.
 */
export function extractUsage(response: {
  usage?: AnthropicResponseUsage | null;
}): LLMUsage | null {
  const u = response.usage;
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

/** Sum two usage records. Either may be null; null + null is null. */
export function mergeUsage(
  a: LLMUsage | null,
  b: LLMUsage | null,
): LLMUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

// ─── Pricing table ──────────────────────────────────────────────────────
//
// Bump `LLM_PRICING_VERSION` AND update the table together when Anthropic
// rotates prices. The version stamp is what makes a historical cost
// figure auditable — "this was computed under pricing-version 2026-05-15"
// is verifiable; "this was computed under whatever prices were in
// effect" is not.

export const LLM_PRICING_VERSION = '2026-05-15';

interface ModelPricing {
  /** Centi-cents (0.01¢) per 1,000,000 input tokens. */
  inputCentiCentsPerMillion: number;
  outputCentiCentsPerMillion: number;
  cacheCreationCentiCentsPerMillion: number;
  cacheReadCentiCentsPerMillion: number;
}

// $3.00 = 300 cents = 30_000 centi-cents
const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    inputCentiCentsPerMillion: 30_000, // $3.00 / MTok
    outputCentiCentsPerMillion: 150_000, // $15.00 / MTok
    cacheCreationCentiCentsPerMillion: 37_500, // $3.75 / MTok
    cacheReadCentiCentsPerMillion: 3_000, // $0.30 / MTok
  },
};

export type CostEstimate =
  | { cents: string; pricingVersion: string; model: string }
  | { cents: null; reason: 'NO_PRICING_DATA'; model: string };

/**
 * Estimate the dollar cost of `usage` for `model`, returned as cents
 * formatted to 4 decimal places (1e-4 cents = 10 nano-dollars — fine
 * enough for per-token granularity).
 *
 * Returns `cents: null` when the pricing table has no entry for the
 * model. Caller renders this as `—` in dashboards and stores the gap
 * in audit metadata so a billing reconciliation can backfill.
 */
export function estimateCostCents(
  model: string,
  usage: LLMUsage,
): CostEstimate {
  const p = PRICING[model];
  if (!p) {
    return { cents: null, reason: 'NO_PRICING_DATA', model };
  }
  // Integer math throughout; divide at the very end.
  const centiCents =
    usage.inputTokens * p.inputCentiCentsPerMillion +
    usage.outputTokens * p.outputCentiCentsPerMillion +
    usage.cacheCreationInputTokens * p.cacheCreationCentiCentsPerMillion +
    usage.cacheReadInputTokens * p.cacheReadCentiCentsPerMillion;
  // centi-cents per 1M tokens × tokens / 1M = centi-cents
  // cents = centi-cents / 100
  const cents = (centiCents / 1_000_000 / 100).toFixed(4);
  return { cents, pricingVersion: LLM_PRICING_VERSION, model };
}
