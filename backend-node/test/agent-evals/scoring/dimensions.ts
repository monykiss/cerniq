/**
 * Agent Evaluation — 6-Dimension Scoring (Vol2 §Testing Strategy).
 *
 * Pure functions, zero side effects. Each scorer takes an agent output, its
 * audit trace, and the expected-findings contract, then returns a normalised
 * 0–1 score and an array of evidence strings for debugging regressions.
 */

import type { z } from 'zod';
import type { ALMDecisionOutputSchema } from '../../../src/agents/contracts/alm-decision.contracts';
import type { RiskMonitorOutputSchema } from '../../../src/agents/contracts/risk-monitor.contracts';
import type { CFOCopilotOutputSchema } from '../../../src/agents/contracts/cfo-copilot.contracts';
import type { CommitteeReportOutputSchema } from '../../../src/agents/contracts/committee-report.contracts';

// ─── Common types ───────────────────────────────────────────────────────────

export interface DimensionResult {
  score: number; // 0–1
  evidence: string[];
}

export interface AuditStep {
  stepKind: string;
  toolName: string | null;
  toolOutput: unknown | null;
}

export interface ExpectedFindings {
  minToolsCalled?: number;
  requiredTools?: string[];
  hasDollarQuantification?: boolean;
  healthScoreRange?: [number, number];
  topRiskDomain?: string;
  requiresBilingual?: boolean;
  schemaValidator?: (output: unknown) => boolean;
}

// ─── 1. Tool Coverage (25%) ─────────────────────────────────────────────────

export function scoreToolCoverage(
  trace: AuditStep[],
  expected: ExpectedFindings,
): DimensionResult {
  const toolCalls = trace.filter((s) => s.stepKind === 'TOOL_CALL');
  const toolNames = new Set(toolCalls.map((s) => s.toolName).filter(Boolean));
  const evidence: string[] = [];

  const minRequired = expected.minToolsCalled ?? 6;
  const calledCount = toolCalls.length;
  const coverageRatio = Math.min(calledCount / minRequired, 1);
  evidence.push(`${calledCount}/${minRequired} tool calls`);

  if (expected.requiredTools) {
    const missing = expected.requiredTools.filter((t) => !toolNames.has(t));
    if (missing.length > 0) {
      evidence.push(`missing required: ${missing.join(', ')}`);
    }
    const requiredHit =
      expected.requiredTools.filter((t) => toolNames.has(t)).length /
      expected.requiredTools.length;
    return {
      score: (coverageRatio + requiredHit) / 2,
      evidence,
    };
  }

  return { score: coverageRatio, evidence };
}

// ─── 2. Dollar Quantification (25%) ─────────────────────────────────────────

export function scoreDollarQuantification(output: unknown): DimensionResult {
  const evidence: string[] = [];
  const obj = output as Record<string, unknown>;

  if (!obj || typeof obj !== 'object') {
    return { score: 0, evidence: ['output is not an object'] };
  }

  const topRisks = (obj as { topRisks?: { dollarImpact?: number }[] }).topRisks;
  if (!Array.isArray(topRisks)) {
    return { score: 0, evidence: ['no topRisks array'] };
  }

  const withDollar = topRisks.filter(
    (r) => typeof r.dollarImpact === 'number' && r.dollarImpact > 0,
  );
  const ratio = topRisks.length > 0 ? withDollar.length / topRisks.length : 0;
  evidence.push(`${withDollar.length}/${topRisks.length} findings with $`);

  return { score: ratio, evidence };
}

// ─── 3. Specificity (20%) ───────────────────────────────────────────────────

const SPECIFICITY_PATTERN =
  /(\$[\d,.]+[MKB]?|[\d.]+%|[\d.]+\s*bps|[\d.]+\s*basis)/i;

export function scoreSpecificity(output: unknown): DimensionResult {
  const evidence: string[] = [];
  const obj = output as {
    decisionQueue?: { action?: string; expectedImpact?: string }[];
    topRisks?: { finding?: string }[];
  };

  const items: string[] = [];
  if (obj?.decisionQueue) {
    for (const d of obj.decisionQueue) {
      if (d.action) items.push(d.action);
      if (d.expectedImpact) items.push(d.expectedImpact);
    }
  }
  if (obj?.topRisks) {
    for (const r of obj.topRisks) {
      if (r.finding) items.push(r.finding);
    }
  }

  if (items.length === 0) {
    return { score: 0, evidence: ['no findings or recommendations'] };
  }

  const specific = items.filter((s) => SPECIFICITY_PATTERN.test(s));
  const ratio = specific.length / items.length;
  evidence.push(`${specific.length}/${items.length} items with specifics`);

  return { score: ratio, evidence };
}

// ─── 4. Regulatory Reference (15%) ──────────────────────────────────────────

export function scoreRegulatoryRef(output: unknown): DimensionResult {
  const evidence: string[] = [];
  const obj = output as {
    topRisks?: { regulatoryRef?: string }[];
    decisionQueue?: { regulatoryRef?: string }[];
  };

  const items = [...(obj?.topRisks ?? []), ...(obj?.decisionQueue ?? [])];

  if (items.length === 0) {
    return { score: 0, evidence: ['no items to check'] };
  }

  const withRef = items.filter(
    (item) =>
      typeof item.regulatoryRef === 'string' &&
      item.regulatoryRef.trim().length > 0,
  );
  const ratio = withRef.length / items.length;
  evidence.push(`${withRef.length}/${items.length} items with reg ref`);

  return { score: ratio, evidence };
}

// ─── 5. Bilingual Completeness (10%) ────────────────────────────────────────

export function scoreBilingual(
  output: unknown,
  requiresBilingual: boolean,
): DimensionResult {
  if (!requiresBilingual) {
    return { score: 1, evidence: ['bilingual not required for this case'] };
  }

  const evidence: string[] = [];
  const obj = output as {
    brief?: string;
    briefEs?: string;
    topRisks?: { finding?: string; findingEs?: string }[];
    decisionQueue?: { action?: string; actionEs?: string }[];
  };

  let total = 0;
  let present = 0;

  if (obj?.brief !== undefined) {
    total++;
    if (obj.brief && obj.brief.length > 0) present++;
  }
  if (obj?.briefEs !== undefined) {
    total++;
    if (obj.briefEs && obj.briefEs.length > 0) present++;
    else evidence.push('briefEs missing');
  }

  for (const r of obj?.topRisks ?? []) {
    total += 2;
    if (r.finding && r.finding.length > 0) present++;
    else evidence.push('finding missing');
    if (r.findingEs && r.findingEs.length > 0) present++;
    else evidence.push('findingEs missing');
  }

  for (const d of obj?.decisionQueue ?? []) {
    total += 2;
    if (d.action && d.action.length > 0) present++;
    if (d.actionEs && d.actionEs.length > 0) present++;
    else evidence.push('actionEs missing');
  }

  const ratio = total > 0 ? present / total : 0;
  evidence.unshift(`${present}/${total} bilingual fields present`);

  return { score: ratio, evidence };
}

// ─── 6. Format Compliance (5%) ──────────────────────────────────────────────

export function scoreFormatCompliance(
  output: unknown,
  validator: ((o: unknown) => boolean) | undefined,
): DimensionResult {
  if (!validator) {
    return { score: 1, evidence: ['no validator provided — pass by default'] };
  }

  try {
    const valid = validator(output);
    return {
      score: valid ? 1 : 0,
      evidence: [valid ? 'schema valid' : 'schema validation failed'],
    };
  } catch (e) {
    return {
      score: 0,
      evidence: [`schema error: ${(e as Error).message}`],
    };
  }
}
