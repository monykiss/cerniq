import { Injectable, Logger } from '@nestjs/common';
import {
  AgentTrustService,
  type AgentTrustInput,
} from '../agent-trust/agent-trust.service';
import type { TrustVerdict } from '../agent-trust/contracts';
import type { AgentRunResult } from './contracts';

export interface ReplayReport {
  runId: string;
  /** Verdict produced at the time the run was persisted. */
  originalVerdict: TrustVerdict | null;
  /** Verdict produced now, re-running the trust layer against the stored trace. */
  currentVerdict: TrustVerdict;
  /** True iff pass/fail outcome matches original. */
  outcomeMatches: boolean;
  /** Violations present now that weren't flagged originally (trust-layer drift). */
  newViolations: string[];
  /** Violations originally flagged that no longer fire (false positives cleaned up). */
  clearedViolations: string[];
}

/**
 * Deterministic replay — re-invokes the trust layer against a persisted run's
 * audit trace and reports any divergence from the original verdict.
 *
 * Two use cases:
 *   1. Regression: when trust rules change, replay the last N days of runs to
 *      surface newly-detected bad outputs (cleanup + backfill alerts).
 *   2. Audit defence: a regulator asks "would this decision fail today's
 *      validators?" — replay answers deterministically with a fresh verdict
 *      and a diff against the recorded one.
 */
@Injectable()
export class ReplayRunnerService {
  private readonly logger = new Logger(ReplayRunnerService.name);

  constructor(private readonly trust: AgentTrustService) {}

  replay(
    priorResult: AgentRunResult,
    priorVerdict: TrustVerdict | null,
    trustInput: Pick<
      AgentTrustInput,
      'outputSchema' | 'requiredLanguage' | 'maxWords'
    >,
  ): ReplayReport {
    const currentVerdict = this.trust.evaluate({
      run: {
        id: priorResult.runId,
        institutionId: priorResult.institutionId,
        agentType: priorResult.agentType,
        status: 'SUCCEEDED',
        input: {},
        output: priorResult.output as unknown as Record<string, unknown>,
        modelVersion: null,
      },
      agentText: priorResult.narrative,
      agentOutput: priorResult.output,
      trace: priorResult.trace,
      outputSchema: trustInput.outputSchema,
      requiredLanguage: trustInput.requiredLanguage,
      maxWords: trustInput.maxWords,
    });

    const originalRules = new Set(
      (priorVerdict?.violations ?? []).map(formatKey),
    );
    const currentRules = new Set(currentVerdict.violations.map(formatKey));
    const newViolations = [...currentRules].filter(
      (k) => !originalRules.has(k),
    );
    const clearedViolations = [...originalRules].filter(
      (k) => !currentRules.has(k),
    );

    const outcomeMatches =
      priorVerdict != null && priorVerdict.pass === currentVerdict.pass;
    if (!outcomeMatches) {
      this.logger.warn(
        `replay: outcome drift on run=${priorResult.runId} prior=${priorVerdict?.pass} current=${currentVerdict.pass}`,
      );
    }
    return {
      runId: priorResult.runId,
      originalVerdict: priorVerdict,
      currentVerdict,
      outcomeMatches,
      newViolations,
      clearedViolations,
    };
  }
}

function formatKey(v: {
  rule: string;
  location?: { start: number; end: number };
}): string {
  if (!v.location) return v.rule;
  return `${v.rule}@${v.location.start}-${v.location.end}`;
}
