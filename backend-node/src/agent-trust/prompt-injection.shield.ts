import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { TrustViolation } from './contracts';

/**
 * Defensive sanitization per Vol2 LLM Security rules #1 and #2:
 *   1. Balance sheet data passed to LLM is pre-processed JSON — never raw user input.
 *   2. Tool outputs are JSON-serialized before insertion into LLM context.
 *
 * Used in two modes:
 *  - {@link fence}: wrap a tool output so the LLM cannot mistake it for a new
 *    instruction (JSON + fence markers + control-char strip).
 *  - {@link scanAgainstUserInput}: detect known injection patterns in text
 *    that originated from a user (copilot queries, CSV string cells) so we can
 *    reject before the prompt is assembled.
 */

export interface FenceOptions {
  /** Maximum characters to include from the tool output. Truncates and marks if exceeded. */
  maxChars?: number;
  /** Label shown inside the fence ("swarm.rateShock", "tool:getLCR"). */
  source: string;
}

/** Known injection phrases, curated rather than ML-derived for auditability. */
const INJECTION_PHRASES: readonly RegExp[] = [
  /ignore (?:all |the )?(?:previous|prior|above) instructions?/i,
  /disregard (?:all |the )?(?:previous|prior|above) instructions?/i,
  /you are now [^.]{0,50}/i,
  /forget everything/i,
  /new instructions?:/i,
  /system prompt:/i,
  /\bjailbreak\b/i,
  /<\s*\/?\s*(?:system|assistant|user)\s*>/i,
  /\[\[(?:system|assistant|user)\]\]/i,
  /BEGIN SYSTEM/i,
  /END SYSTEM/i,
  // Tool-call forging.
  /\btool_use\s*:/i,
  /<tool_call>/i,
];

/**
 * Strip C0 control chars except tab/LF/CR which have legitimate uses.
 * The no-control-regex lint is disabled here because stripping control
 * characters is the explicit security purpose of this pattern — an LLM
 * fed a NUL byte could interpret it as a token boundary and be tricked
 * into following injected instructions.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const DEFAULT_MAX_CHARS = 32_000;

@Injectable()
export class PromptInjectionShield {
  private readonly logger = new Logger(PromptInjectionShield.name);

  /**
   * Serialize + fence a tool output so the LLM treats it as quoted data.
   * Fence markers are randomized per call to foil prompts that echo the marker
   * back.
   */
  fence(payload: unknown, opts: FenceOptions): string {
    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const nonce = randomNonce();
    const json = safeStringify(payload);
    const stripped = json.replace(CONTROL_CHAR_RE, '');
    const body =
      stripped.length > maxChars
        ? `${stripped.slice(0, maxChars)}\n…[truncated ${stripped.length - maxChars} chars]`
        : stripped;
    return [
      `<<<TOOL_OUTPUT source=${JSON.stringify(opts.source)} nonce=${nonce}>>>`,
      body,
      `<<<END_TOOL_OUTPUT nonce=${nonce}>>>`,
    ].join('\n');
  }

  /** Scan user-originated text for injection patterns. */
  scanAgainstUserInput(text: string): TrustViolation[] {
    if (!text) return [];
    const hits: TrustViolation[] = [];
    for (const re of INJECTION_PHRASES) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({
        rule: 'PROMPT_INJECTION_SUSPECTED',
        severity: 'BLOCK',
        message: `User-supplied text contains a known injection pattern; refusing to inline into LLM prompt.`,
        location: { start: m.index, end: m.index + m[0].length },
        evidence: { phrase: m[0] },
      });
    }
    return hits;
  }

  /** True iff the given string is safe to include inline (no injection, no control chars). */
  isSafeForInline(text: string): boolean {
    if (CONTROL_CHAR_RE.test(text)) return false;
    for (const re of INJECTION_PHRASES) {
      re.lastIndex = 0;
      if (re.test(text)) return false;
    }
    return true;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return JSON.stringify({ __unstringifiable: true });
  }
}

function randomNonce(): string {
  // KLYTICS Rule 12: nonce in a security-scope file must use crypto-grade
  // randomness — a predictable fence marker lets an attacker close the
  // fenced tool output and inject a new instruction. 4 bytes = 8 hex chars
  // (≈32 bits of entropy, sufficient for per-call uniqueness).
  return randomBytes(4).toString('hex');
}
