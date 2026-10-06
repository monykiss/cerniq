/**
 * Evaluation gate constants. Single source of truth — CI, dashboard, and the
 * release-gate script all read these. Tuned per Vol2 Regression Scoring
 * Framework and Vol3 Layer 1 "Accuracy" gate.
 */
export const EvalThresholds = {
  /** Average weighted score in [0,100]. Below this, CI blocks deploy. */
  deployGate: 80,
  /** Point drop vs. baseline that triggers an investigation (not yet block). */
  regressionInvestigate: 5,
  /** Tolerance for the number-citation validator during replay (±%). */
  citationTolerancePct: 0.01,
  /** Vol3 Layer 1: dollar figures must match ±2% of manual calc. */
  accuracyDollarTolerancePct: 0.02,
} as const;

/**
 * Dimension weights (must sum to 1.0). Mirrors Vol2 §Regression Scoring.
 * Frozen so a typo elsewhere cannot silently mutate.
 */
export const ScoreWeights = Object.freeze({
  toolCoverage: 0.25,
  dollarQuantification: 0.25,
  specificity: 0.2,
  regulatoryReference: 0.15,
  bilingualCompleteness: 0.1,
  formatCompliance: 0.05,
} as const);

export type DimensionKey = keyof typeof ScoreWeights;
