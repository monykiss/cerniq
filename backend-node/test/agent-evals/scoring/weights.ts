/**
 * Composite scorer — weighted roll-up of all 6 dimensions (Vol2 §Testing).
 */

import type {
  DimensionResult,
  AuditStep,
  ExpectedFindings,
} from './dimensions';
import {
  scoreToolCoverage,
  scoreDollarQuantification,
  scoreSpecificity,
  scoreRegulatoryRef,
  scoreBilingual,
  scoreFormatCompliance,
} from './dimensions';

export interface DimensionWeight {
  toolCoverage: number;
  dollarQuantification: number;
  specificity: number;
  regulatoryRef: number;
  bilingual: number;
  formatCompliance: number;
}

export const DEFAULT_WEIGHTS: DimensionWeight = {
  toolCoverage: 0.25,
  dollarQuantification: 0.25,
  specificity: 0.2,
  regulatoryRef: 0.15,
  bilingual: 0.1,
  formatCompliance: 0.05,
};

export const PASS_THRESHOLD = 0.8;
export const REGRESSION_DROP_THRESHOLD = 0.05;

export interface DimensionBreakdown {
  score: number;
  weight: number;
  weighted: number;
  evidence: string[];
}

export interface CompositeScore {
  total: number;
  pass: boolean;
  breakdown: Record<keyof DimensionWeight, DimensionBreakdown>;
}

export function scoreAgentRun(
  output: unknown,
  trace: AuditStep[],
  expected: ExpectedFindings,
  weights: DimensionWeight = DEFAULT_WEIGHTS,
): CompositeScore {
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    throw new Error(`weights must sum to 1.0, got ${weightSum.toFixed(4)}`);
  }

  const dims: Record<keyof DimensionWeight, DimensionResult> = {
    toolCoverage: scoreToolCoverage(trace, expected),
    dollarQuantification: scoreDollarQuantification(output),
    specificity: scoreSpecificity(output),
    regulatoryRef: scoreRegulatoryRef(output),
    bilingual: scoreBilingual(output, expected.requiresBilingual ?? false),
    formatCompliance: scoreFormatCompliance(output, expected.schemaValidator),
  };

  const breakdown = {} as Record<keyof DimensionWeight, DimensionBreakdown>;
  let total = 0;

  for (const key of Object.keys(dims) as Array<keyof DimensionWeight>) {
    const dim = dims[key];
    const w = weights[key];
    const weighted = dim.score * w;
    total += weighted;
    breakdown[key] = {
      score: dim.score,
      weight: w,
      weighted,
      evidence: dim.evidence,
    };
  }

  return {
    total: Math.round(total * 100) / 100,
    pass: total >= PASS_THRESHOLD,
    breakdown,
  };
}
