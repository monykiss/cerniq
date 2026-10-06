import { Injectable, Logger, Optional } from '@nestjs/common';
import type { AgentAuditLogReadModel, TrustViolation } from './contracts';

/**
 * Enforces Vol2 principle #2: "No LLM output that contains a financial number
 * is accepted without a matching tool call in the audit trace."
 *
 * Strategy: extract every numeric claim from the agent output, normalize all
 * numbers from tool outputs into a canonical bag, and fail any claim that
 * cannot be matched within {@link tolerancePct}.
 */

export interface NumberClaim {
  /** Canonical numeric value (e.g. "$1.2M" → 1_200_000). */
  value: number;
  /** Raw text as it appeared in the output. */
  raw: string;
  /** Character span in the source text. */
  location: { start: number; end: number };
  /** Hint about what kind of number — used to pick tolerance. */
  kind: 'currency' | 'percent' | 'bps' | 'ratio' | 'count';
}

export interface CitationCheck {
  matched: NumberClaim[];
  uncited: NumberClaim[];
}

const CURRENCY_RE =
  /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([KkMmBb])?/g;
const PERCENT_RE = /(?<![A-Za-z0-9_])(-?\d+(?:\.\d+)?)\s?%/g;
const BPS_RE = /(?<![A-Za-z0-9_])(-?\d+(?:\.\d+)?)\s?bps\b/gi;
const PLAIN_LARGE_RE = /(?<![A-Za-z0-9_.])(\d{1,3}(?:,\d{3}){1,})(?:\.(\d+))?/g;

const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
};

/** Default tolerance: ±1%. Matches Vol2 "accuracy" gate (±2%) with headroom. */
const DEFAULT_TOLERANCE_PCT = 0.01;

/** Numbers below this magnitude are ignored (step counts, years, indices). */
const MIN_MATERIAL_VALUE = 100;

/** Four-digit years in [1900, 2100] are almost never financial claims. */
const isLikelyYear = (n: number): boolean =>
  Number.isInteger(n) && n >= 1900 && n <= 2100;

@Injectable()
export class NumberCitationValidator {
  private readonly logger = new Logger(NumberCitationValidator.name);

  /**
   * @Optional() on the tolerance-percent param tells NestJS not to try
   * to inject a `Number` provider when resolving this service through
   * its DI graph. Without it, the @Injectable() decoration combined
   * with the `number` parameter type causes reflection to look up a
   * provider keyed by the `Number` wrapper class (which doesn't exist
   * in the container), and every e2e test that bootstraps AppModule
   * fails with:
   *   "Nest can't resolve dependencies of the NumberCitationValidator
   *    (?). Please make sure that the argument Number at index [0] is
   *    available in the AgentTrustModule module."
   */
  constructor(
    @Optional() private readonly tolerancePct: number = DEFAULT_TOLERANCE_PCT,
  ) {}

  /** Extract every numeric claim from a piece of text. */
  extractClaims(text: string): NumberClaim[] {
    if (!text) return [];
    const claims: NumberClaim[] = [];

    for (const m of text.matchAll(CURRENCY_RE)) {
      const base = Number(m[1].replace(/,/g, ''));
      const suffix = (m[2] ?? '').toLowerCase();
      const mult = suffix ? (SUFFIX_MULTIPLIER[suffix] ?? 1) : 1;
      const value = base * mult;
      claims.push({
        value,
        raw: m[0],
        location: { start: m.index, end: m.index + m[0].length },
        kind: 'currency',
      });
    }

    for (const m of text.matchAll(PERCENT_RE)) {
      const value = Number(m[1]);
      claims.push({
        value,
        raw: m[0],
        location: { start: m.index, end: m.index + m[0].length },
        kind: 'percent',
      });
    }

    for (const m of text.matchAll(BPS_RE)) {
      const value = Number(m[1]);
      claims.push({
        value,
        raw: m[0],
        location: { start: m.index, end: m.index + m[0].length },
        kind: 'bps',
      });
    }

    for (const m of text.matchAll(PLAIN_LARGE_RE)) {
      const intPart = m[1].replace(/,/g, '');
      const frac = m[2] ?? '';
      const value = Number(frac ? `${intPart}.${frac}` : intPart);
      if (isLikelyYear(value)) continue;
      if (this.isOverlappingWithPrior(claims, m.index)) continue;
      claims.push({
        value,
        raw: m[0],
        location: { start: m.index, end: m.index + m[0].length },
        kind: 'count',
      });
    }

    return claims
      .filter(
        (c) =>
          c.kind === 'percent' ||
          c.kind === 'bps' ||
          c.value >= MIN_MATERIAL_VALUE,
      )
      .sort((a, b) => a.location.start - b.location.start);
  }

  /** Walk every tool output in the audit trace and collect every number within. */
  collectCitedNumbers(trace: readonly AgentAuditLogReadModel[]): number[] {
    const bag: number[] = [];
    for (const step of trace) {
      if (step.stepType !== 'TOOL_CALL' || !step.toolOutput) continue;
      this.walk(step.toolOutput, bag);
    }
    return bag;
  }

  /** Reconcile claims against the tool-output bag. */
  check(
    claims: readonly NumberClaim[],
    cited: readonly number[],
  ): CitationCheck {
    const matched: NumberClaim[] = [];
    const uncited: NumberClaim[] = [];
    for (const claim of claims) {
      if (this.findMatch(claim, cited) !== null) matched.push(claim);
      else uncited.push(claim);
    }
    return { matched, uncited };
  }

  /** End-to-end: extract, reconcile, and emit trust violations for any uncited claim. */
  validate(
    agentText: string,
    trace: readonly AgentAuditLogReadModel[],
  ): TrustViolation[] {
    const claims = this.extractClaims(agentText);
    if (claims.length === 0) return [];
    const cited = this.collectCitedNumbers(trace);
    const { uncited } = this.check(claims, cited);
    return uncited.map((claim) => ({
      rule: 'NUMBER_NOT_CITED' as const,
      severity: 'BLOCK' as const,
      message: `Agent output contains the value "${claim.raw}" (${claim.value}) which is not present in any tool call output. Vol2 principle #2: no financial number without a matching tool call.`,
      location: claim.location,
      evidence: {
        kind: claim.kind,
        value: claim.value,
        nearestCited: this.findNearest(claim.value, cited),
        tolerancePct: this.tolerancePct,
      },
    }));
  }

  private findMatch(
    claim: NumberClaim,
    cited: readonly number[],
  ): number | null {
    for (const n of cited) {
      if (this.isClose(claim.value, n)) return n;
    }
    return null;
  }

  private findNearest(v: number, cited: readonly number[]): number | null {
    if (cited.length === 0) return null;
    const absV = Math.abs(v);
    let best = cited[0];
    let bestDelta = Math.abs(Math.abs(best) - absV);
    for (let i = 1; i < cited.length; i++) {
      const d = Math.abs(Math.abs(cited[i]) - absV);
      if (d < bestDelta) {
        best = cited[i]!;
        bestDelta = d;
      }
    }
    return best;
  }

  private isClose(a: number, b: number): boolean {
    if (a === b) return true;
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    if (absA === absB) return true;
    const denom = Math.max(absA, absB, 1e-9);
    return Math.abs(absA - absB) / denom <= this.tolerancePct;
  }

  private walk(value: unknown, bag: number[]): void {
    if (typeof value === 'number' && Number.isFinite(value)) {
      bag.push(value);
      return;
    }
    if (typeof value === 'string') {
      const n = Number(value);
      if (!Number.isNaN(n) && Number.isFinite(n) && value.trim() !== '')
        bag.push(n);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) this.walk(v, bag);
      return;
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) this.walk(v, bag);
    }
  }

  private isOverlappingWithPrior(
    claims: readonly NumberClaim[],
    start: number,
  ): boolean {
    for (const c of claims) {
      if (start >= c.location.start && start < c.location.end) return true;
    }
    return false;
  }
}
