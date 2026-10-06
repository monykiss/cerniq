import { Injectable } from '@nestjs/common';
import type { TrustViolation } from './contracts';

/**
 * Vol3 failure taxonomy — "Hedging" row:
 *   Symptom: Output contains "may", "might", "could", "consider"
 *   Root cause: Prompt does not prohibit hedge language
 *   Fix: Add explicit NEVER list. Test with hedge-detector in eval.
 *
 * This is the detector half. Returns WARN (not BLOCK) — hedges are a
 * prompt-tuning signal, not a safety issue. Eval uses the WARN count as a
 * "Specificity" dimension input (Vol2 regression scoring weight 20%).
 */

const HEDGE_TOKENS: readonly string[] = [
  'may',
  'might',
  'could',
  'consider',
  'perhaps',
  'possibly',
  'potentially',
  'seemingly',
  'appears to',
  'appears that',
  'suggests that',
  'somewhat',
  'roughly',
];

const HEDGE_RE = new RegExp(
  `\\b(?:${HEDGE_TOKENS.map((t) => t.replace(/\s/g, '\\s+')).join('|')})\\b`,
  'gi',
);

/** "approximately" is not a hedge when paired with a tool-cited number. */
const APPROXIMATELY_RE = /\bapproximately\b/gi;

@Injectable()
export class HedgeLanguageDetector {
  detect(text: string): TrustViolation[] {
    if (!text) return [];
    const hits: TrustViolation[] = [];
    HEDGE_RE.lastIndex = 0;
    for (const m of text.matchAll(HEDGE_RE)) {
      hits.push({
        rule: 'HEDGE_LANGUAGE',
        severity: 'WARN',
        message: `Agent output contains hedge token "${m[0]}". CFO-level outputs must not hedge; re-phrase with the concrete number or omit.`,
        location: { start: m.index, end: m.index + m[0].length },
        evidence: { token: m[0] },
      });
    }
    return hits;
  }

  /** Count of hedge hits — fed directly into the eval regression scorer. */
  count(text: string): number {
    if (!text) return 0;
    let n = 0;
    HEDGE_RE.lastIndex = 0;
    for (const _ of text.matchAll(HEDGE_RE)) n++;
    APPROXIMATELY_RE.lastIndex = 0;
    for (const _ of text.matchAll(APPROXIMATELY_RE)) n++;
    return n;
  }
}
