import { createHash } from 'crypto';

// ─── Prompt provenance — KLYTICS Audit Discipline Rule 9 ────────────────
//
// Every LLM result row that persists to the audit trail must carry a
// `promptVersion`: a short, stable fingerprint of what produced the
// output. Without it, a prompt regression that ships in a deploy is
// indistinguishable from a model behavior change — both look like "the
// analyst is suddenly worse" with no way to bisect.
//
// The fingerprint hashes the inputs that, if changed, would produce a
// different output distribution: the model id, the system prompt text,
// the tool catalog (since tool schemas steer the model), and the
// temperature when explicitly set. Sampling defaults stay implicit by
// design — the fingerprint reflects what *we* chose, not what the
// provider's defaults happen to be on a given day.

export interface PromptVersionInput {
  /** Anthropic model identifier (e.g. `claude-sonnet-4-20250514`). */
  model: string;
  /** Full system prompt text passed to `messages.create({ system })`. */
  systemPrompt: string;
  /**
   * Tool catalog passed to `messages.create({ tools })`. Order matters
   * to the model, so we hash the serialized form rather than a sorted
   * normalization — a reorder is a different prompt for our purposes.
   */
  tools?: unknown;
  /** Only included when explicitly passed by the caller. */
  temperature?: number;
}

/**
 * Compute a 12-char hex prompt fingerprint. SHA-256, take the first 12
 * chars (48 bits) — enough entropy to collision-bisect within a single
 * tenant's traffic, short enough to fit in dashboard cells and grep
 * output without wrapping.
 *
 * Stable across runs: same input bytes → same output. Use this at the
 * start of an LLM-using path; thread the result into any persisted
 * record of the result (audit log, conversation history, cost ledger).
 */
export function computePromptVersion(input: PromptVersionInput): string {
  const h = createHash('sha256');
  h.update('model:', 'utf8');
  h.update(input.model, 'utf8');
  h.update('\0prompt:', 'utf8');
  h.update(input.systemPrompt, 'utf8');
  if (input.tools !== undefined) {
    h.update('\0tools:', 'utf8');
    h.update(JSON.stringify(input.tools), 'utf8');
  }
  if (input.temperature !== undefined) {
    h.update('\0temp:', 'utf8');
    h.update(String(input.temperature), 'utf8');
  }
  return h.digest('hex').slice(0, 12);
}
