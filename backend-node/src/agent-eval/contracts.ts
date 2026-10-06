import type {
  AgentType,
  AgentAuditLogReadModel,
} from '../agent-trust/contracts';

/**
 * Shape of a single golden-case fixture for the regression harness
 * (Vol3 §Agent eval framework, Vol2 §Agent Evaluation Test Pattern).
 *
 * Every fixture lives under test/agent-golden/<agent>/golden-NNN.ts and is
 * plain TS so it can be typechecked, not parsed at runtime.
 */
export interface GoldenCase<Params = Record<string, unknown>> {
  id: string;
  name: string;
  agentType: AgentType;
  /** Parameters passed verbatim to the agent runner (balanceSheetId, etc). */
  params: Params;
  expected: GoldenExpectations;
}

export interface GoldenExpectations {
  topRiskDomain?: string;
  /** At least one finding must carry a $ amount. */
  hasMinDollarQuantification?: boolean;
  /** Inclusive range the health score must fall within. */
  healthScoreRange?: [number, number];
  /** At least one finding must cite a reg code. */
  hasRegulatoryReference?: boolean;
  /** Minimum tool call count (Vol3: "Agent calls ≥6 tools on test balance sheet"). */
  toolsCalledMin?: number;
  /** Bilingual required (PR institutions). */
  bilingualRequired?: boolean;
  /** Word-count cap from Vol3 failure taxonomy (600 brief / 300 copilot). */
  maxWords?: number;
  /** Specific reg codes that must appear somewhere in the output. */
  requiredRegulatoryCodes?: string[];
}

export interface AgentRunResult {
  runId: string;
  institutionId: string;
  agentType: AgentType;
  output: AgentOutput;
  trace: readonly AgentAuditLogReadModel[];
  narrative: string;
  /** Milliseconds end-to-end. */
  computeMs: number;
}

/** Minimal output shape — any agent-specific extension just widens this. */
export interface AgentOutput {
  topRisks?: readonly {
    domain: string;
    dollarImpact?: number;
    recommendation?: string;
    regulatoryRef?: string;
  }[];
  healthScore?: { score: number; label: string };
  findings?: readonly unknown[];
  languages?: { en?: string; es?: string };
}

/** Six-dimension breakdown (Vol2 §Regression Scoring Framework). */
export interface ScoreBreakdown {
  toolCoverage: number;
  dollarQuantification: number;
  specificity: number;
  regulatoryReference: number;
  bilingualCompleteness: number;
  formatCompliance: number;
  /** Weighted total in [0, 100]. */
  total: number;
}

export interface CaseScore {
  caseId: string;
  caseName: string;
  score: ScoreBreakdown;
  /** Per-expectation pass/fail reasons. */
  failures: string[];
}

export interface RegressionReport {
  /** ISO timestamp. */
  runAt: string;
  /** Average weighted score across cases. */
  averageScore: number;
  cases: CaseScore[];
  /** Cases that scored below the {@link EvalThresholds.deployGate} floor. */
  blockedCases: string[];
  /** vs. baseline score — negative = regression. */
  deltaFromBaseline: number | null;
  /** True iff deploy gate satisfied. */
  passesDeployGate: boolean;
}
