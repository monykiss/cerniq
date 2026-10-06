import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

// Thin wrapper over @anthropic-ai/sdk exposing just the primitives the agent
// runner needs: tool-use turn execution with pluggable tool descriptors.
// Keeping this narrow (no streaming helpers, no memory, no routing) means
// swapping providers later touches one file.
//
// Model pinning: we pin the model ID here and version-stamp it on every
// audit row via the run-level prompt/agent version. Changing the model is
// a deliberate, auditable event, not a silent drift.

export const AGENT_LLM_MODEL = 'claude-opus-4-6';

// Public Anthropic list pricing for claude-opus-4-6 as of 2026-04.
// Operators override via LLM_INPUT_USD_PER_MILLION_TOKENS /
// LLM_OUTPUT_USD_PER_MILLION_TOKENS when on a negotiated enterprise
// rate. Defaults are intentionally conservative — the cost circuit
// breaker trips earlier than necessary for customers on discounted
// rates, which is the safe direction.
const DEFAULT_INPUT_USD_PER_MILLION_TOKENS = 15;
const DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS = 75;
const DEFAULT_MAX_AGENT_TOKENS = 4096;

export interface LLMToolDescriptor {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface LLMTurnRequest {
  system: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: unknown }
          | {
              type: 'tool_result';
              tool_use_id: string;
              content: string;
              is_error?: boolean;
            }
        >;
  }>;
  tools: LLMToolDescriptor[];
  maxTokens?: number;
  temperature?: number;
  // Run-scoped abort signal so the per-run deadline (D9) can cut
  // short an in-flight LLM call, not just an in-flight tool call.
  // Without this, a stuck provider call would survive the deadline
  // up to the SDK's internal 10-minute timeout.
  signal?: AbortSignal;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMTurnResponse {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  text: string;
  toolCalls: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class LlmBridgeService {
  private readonly logger = new Logger(LlmBridgeService.name);
  private readonly client: Anthropic;

  constructor() {
    // Forward the opt-in ANTHROPIC_BETA_HEADER as `anthropic-beta` on
    // every request. Previously this env var was documented in
    // `.env.example` and validated in `env.schema.ts` but never read
    // by any code — operators setting it saw no effect.
    const betaHeader = process.env.ANTHROPIC_BETA_HEADER?.trim();
    const defaultHeaders: Record<string, string> = {};
    if (betaHeader) defaultHeaders['anthropic-beta'] = betaHeader;

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      defaultHeaders: Object.keys(defaultHeaders).length
        ? defaultHeaders
        : undefined,
    });
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  /**
   * Compute USD cost in integer cents from token counts. Exported
   * static so the runner and specs can call it without instantiating
   * the bridge. Rates are read fresh from env on each call so tests
   * can override them; the two-decimal rounding matches the Stripe
   * invariant (cents are integers).
   */
  static computeCostUsdCents(
    inputTokens: number,
    outputTokens: number,
    env: NodeJS.ProcessEnv = process.env,
  ): number {
    const inputRate = LlmBridgeService.resolveRate(
      env.LLM_INPUT_USD_PER_MILLION_TOKENS,
      DEFAULT_INPUT_USD_PER_MILLION_TOKENS,
    );
    const outputRate = LlmBridgeService.resolveRate(
      env.LLM_OUTPUT_USD_PER_MILLION_TOKENS,
      DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS,
    );
    // Compute directly in cents to avoid IEEE-754 drift on the
    // USD-to-cents conversion. The original `(usd * 100)` form
    // produced `22.499999999999996` for a 0.225-USD run and rounded
    // *down* to 22 cents — under-reporting by a cent on every run
    // whose total fell on a non-representable binary fraction.
    // Since `rate` is USD per million tokens, `rate / 10_000` is
    // cents per token, and `tokens * rate / 10_000` stays in exact
    // float as long as `tokens` is integer and `rate * tokens` fits
    // in a double's 2^53 mantissa (true up to ~9e15 per rate unit).
    const inputCents = (inputTokens * inputRate) / 10_000;
    const outputCents = (outputTokens * outputRate) / 10_000;
    return Math.round(inputCents + outputCents);
  }

  private static resolveRate(
    raw: string | undefined,
    fallback: number,
  ): number {
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  }

  private static resolveMaxTokens(env: NodeJS.ProcessEnv): number {
    const raw = env.MAX_AGENT_TOKENS;
    if (raw === undefined || raw === '') return DEFAULT_MAX_AGENT_TOKENS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      return DEFAULT_MAX_AGENT_TOKENS;
    }
    return parsed;
  }

  async turn(req: LLMTurnRequest): Promise<LLMTurnResponse> {
    const response = await this.client.messages.create(
      {
        model: AGENT_LLM_MODEL,
        // Caller override wins; otherwise honor MAX_AGENT_TOKENS env.
        // Before this the env var was validated but never consulted,
        // so operators setting MAX_AGENT_TOKENS=8192 kept getting 4096.
        max_tokens:
          req.maxTokens ?? LlmBridgeService.resolveMaxTokens(process.env),
        temperature: req.temperature ?? 0.2,
        system: req.system,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as any,
        })),
        messages: req.messages as any,
      },
      // Second-arg request options: pass the run-scoped signal so
      // the Anthropic SDK aborts the in-flight fetch when the runner's
      // deadline fires. Closes the gap left after D9 where tool calls
      // were cancellable but LLM turns weren't.
      req.signal ? { signal: req.signal } : undefined,
    );

    const toolCalls: LLMToolCall[] = [];
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    return {
      stopReason: response.stop_reason as LLMTurnResponse['stopReason'],
      text,
      toolCalls,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}
