import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import type {
  AgentAuditLogReadModel,
  AgentRunReadModel,
  TrustSeverity,
  TrustVerdict,
  TrustViolation,
} from './contracts';
import { HedgeLanguageDetector } from './hedge-language.detector';
import { NumberCitationValidator } from './number-citation.validator';
import { OutputSchemaValidator } from './output-schema.validator';
import { PiiRedactorService } from './pii-redactor.service';
import { PromptInjectionShield } from './prompt-injection.shield';

export interface AgentTrustInput<T = unknown> {
  run: AgentRunReadModel;
  /** The raw text the agent produced (narrative portion). */
  agentText: string;
  /** The structured output to persist (JSON). */
  agentOutput: unknown;
  /** Full audit trace for the run — drives number-citation check. */
  trace: readonly AgentAuditLogReadModel[];
  /** Schema the structured output must satisfy. */
  outputSchema: ZodType<T>;
  /** Language flag for the MISSING_BILINGUAL check. */
  requiredLanguage?: 'en' | 'es' | 'bilingual';
  /** Hard word-count ceiling (Vol3 failure taxonomy "Over-length"). */
  maxWords?: number;
}

/**
 * Orchestrates all five trust checks into a single verdict. Call exactly once
 * per agent run, after the LLM returns and BEFORE persisting the output.
 *
 * The service is intentionally stateless — all configuration (tolerance, word
 * limits, schemas) is passed per call so the same instance can serve all four
 * agent types with different policies.
 */
@Injectable()
export class AgentTrustService {
  private readonly logger = new Logger(AgentTrustService.name);

  constructor(
    private readonly numberCitation: NumberCitationValidator,
    private readonly piiRedactor: PiiRedactorService,
    private readonly promptInjection: PromptInjectionShield,
    private readonly hedgeDetector: HedgeLanguageDetector,
    private readonly outputSchema: OutputSchemaValidator,
  ) {}

  evaluate<T>(input: AgentTrustInput<T>): TrustVerdict {
    const started = Date.now();
    const violations: TrustViolation[] = [];

    // 1. Output schema (fails fast — if shape is wrong, other checks are noise).
    const schemaRes = this.outputSchema.validate(
      input.outputSchema,
      input.agentOutput,
    );
    violations.push(...schemaRes.violations);

    // 2. Number citation — Vol2 principle #2.
    violations.push(
      ...this.numberCitation.validate(input.agentText, input.trace),
    );

    // 3. PII scan — Vol2 LLM Security #5.
    violations.push(...this.piiRedactor.validate(input.agentText));

    // 4. Prompt-injection residue in the agent's own text (rare but possible if
    //    an upstream tool echoed attacker content through without fencing).
    violations.push(
      ...this.promptInjection.scanAgainstUserInput(input.agentText),
    );

    // 5. Hedge language — Vol3 failure taxonomy.
    violations.push(...this.hedgeDetector.detect(input.agentText));

    // 6. Bilingual requirement for PR institutions.
    if (
      input.requiredLanguage === 'bilingual' &&
      !this.looksBilingual(input.agentText)
    ) {
      violations.push({
        rule: 'MISSING_BILINGUAL',
        severity: 'BLOCK',
        message:
          'Puerto Rico institution requires EN + ES in every output. Only one language detected.',
      });
    }

    // 7. Over-length — caller-configured cap.
    if (input.maxWords) {
      const words = countWords(input.agentText);
      if (words > input.maxWords) {
        violations.push({
          rule: 'OVER_LENGTH',
          severity: 'WARN',
          message: `Output is ${words} words (cap ${input.maxWords}). Vol3 failure taxonomy: hard cap 600 for brief, 300 for copilot.`,
          evidence: { words, cap: input.maxWords },
        });
      }
    }

    const summary = tally(violations);
    const verdict: TrustVerdict = {
      pass: summary.block === 0,
      violations,
      summary,
      evaluatedInMs: Date.now() - started,
    };

    if (!verdict.pass) {
      this.logger.warn(
        `agent-trust BLOCK run=${input.run.id} type=${input.run.agentType} violations=${summary.block} warn=${summary.warn}`,
      );
    }
    return verdict;
  }

  /**
   * Quick bilingual heuristic — presence of at least one Spanish-only marker
   * (accented vowels or common function words) plus one English-only marker.
   * Not a language classifier; the agent prompt is what actually enforces
   * bilingual output. This is a last-line trip wire.
   */
  private looksBilingual(text: string): boolean {
    const hasEs =
      /[áéíóúñÁÉÍÓÚÑ]|(?:\b(?:el|la|los|las|que|para|riesgo|tasa|cartera)\b)/i.test(
        text,
      );
    const hasEn = /\b(?:the|and|rate|risk|portfolio|liquidity|impact)\b/i.test(
      text,
    );
    return hasEs && hasEn;
  }
}

function tally(violations: readonly TrustViolation[]): TrustVerdict['summary'] {
  const summary: TrustVerdict['summary'] = { block: 0, warn: 0, info: 0 };
  for (const v of violations) summary[severityKey(v.severity)]++;
  return summary;
}

function severityKey(s: TrustSeverity): 'block' | 'warn' | 'info' {
  switch (s) {
    case 'BLOCK':
      return 'block';
    case 'WARN':
      return 'warn';
    case 'INFO':
      return 'info';
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
