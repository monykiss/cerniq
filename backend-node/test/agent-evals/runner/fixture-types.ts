import type { ExpectedFindings, AuditStep } from '../scoring/dimensions';

export interface GoldenCase {
  id: string;
  name: string;
  agentId: string;
  description: string;
  input: Record<string, unknown>;
  expectedFindings: ExpectedFindings;
  /** If provided, overrides mock-anthropic sequence path auto-discovery. */
  scriptPath?: string;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  agentId: string;
  score: number;
  pass: boolean;
  breakdown: Record<
    string,
    { score: number; weight: number; evidence: string[] }
  >;
  durationMs: number;
  toolsCalled: string[];
  error?: string;
}

export interface EvalBaseline {
  agentId: string;
  meanScore: number;
  perCase: Record<string, number>;
  updatedAt: string;
  note: string;
}
