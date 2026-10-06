/**
 * Contract drift guard — three layers:
 *
 *   (L1) Prisma-enum drift: every FE enum literal type in types/agents.ts
 *        matches its source enum in schema.prisma. Catches "BE added a new
 *        agent id, FE silently dropped it" — UI renders "unknown" otherwise.
 *
 *   (L2) Zod contract-shape drift: every FE interface in types/agents.ts
 *        that mirrors a Zod schema in backend-node/src/agents/contracts/*
 *        has the exact same top-level field set as the schema. Catches
 *        "BE added a new optional field, FE missed it" — the silent dropper
 *        of bilingual / DataGap / nullable fields that the FAANG bar D1
 *        invariant ("Never silent zeros") cares about most.
 *
 *   (L3) Zod literal-value drift: every BE `z.literal('xxx')` (the
 *        discriminator value that determines which output schema parses a
 *        runtime response) matches the FE interface's string-literal type.
 *        Catches "BE renamed 'alm_decision' to 'alm-decision'" — L2 misses
 *        this because the field NAME is unchanged, but every FE switch
 *        statement that branches on `agentId === 'alm_decision'` silently
 *        dead-codes. The FE side is locked at TS compile time via
 *        `: SomeType['field']` constraints; the BE side is parsed from
 *        contract source at test time.
 *
 * All three layers read source files via fs + regex rather than importing
 * across the FE/BE boundary, matching the existing schema.prisma-reading
 * pattern and avoiding cross-project tsconfig / bundle wiring.
 *
 * Failure mode: strict by default. When BE adds a field, the corresponding
 * FE manifest below MUST be updated in the same PR. To accept transient
 * drift, remove the field from the manifest and add a `// drift-allow: ...`
 * comment naming the reason and the catch-up PR.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import type {
  AgentId,
  AgentRunStatus,
  AgentTriggerKind,
  AgentAuditStepKind,
  Severity,
  AlertStatus,
  HealthSnapshot,
  TopRisk,
  DecisionQueueItem,
  ALMDecisionOutput,
  RiskAlert,
  RiskMonitorOutput,
  CFOCopilotFollowup,
  CFOCopilotOutput,
  CommitteeRecommendation,
  RegulatoryCalendarItem,
  CommitteeReportOutput,
} from '../agents';
import { AGENT_LABEL } from '../agents';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'backend-node', 'prisma', 'schema.prisma');
const CONTRACTS_DIR = join(
  REPO_ROOT,
  'backend-node',
  'src',
  'agents',
  'contracts',
);

function parsePrismaEnum(enumName: string): string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const regex = new RegExp(`enum ${enumName}\\s*\\{([^}]+)\\}`, 's');
  const match = schema.match(regex);
  if (!match) throw new Error(`Enum ${enumName} not found in schema.prisma`);
  return match[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));
}

// ─── L2 plumbing: extract field names from Zod schema source text ───────────
//
// Pure source-text parser; deliberately ignorant of Zod runtime. Walks the
// `z.object({ ... })` block (or a nested z.object inside a parent field)
// with a balanced brace/paren counter, ignoring contents of strings and
// comments, and collects identifiers that begin a property declaration at
// depth 1 of the target object literal.
//
// Path selector lets us drill into a nested anonymous object — e.g. the
// `sections` block inside CommitteeReportOutputSchema. Single-level
// nesting only; deeper paths can be added when the surface demands.

function loadContract(file: string): string {
  return readFileSync(join(CONTRACTS_DIR, file), 'utf-8');
}

function findObjectBody(text: string, anchor: string): string {
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error(`anchor "${anchor}" not found in contract source`);
  const objMatch = text.slice(idx).match(/z\s*\.\s*object\s*\(\s*\{/);
  if (!objMatch) throw new Error(`no z.object({ after anchor "${anchor}"`);
  const start = idx + objMatch.index! + objMatch[0].length;
  return sliceMatchingBrace(text, start);
}

function findNestedObjectBody(body: string, fieldName: string): string {
  const fieldIdx = findFieldDeclarationIndex(body, fieldName);
  if (fieldIdx < 0) {
    throw new Error(`nested field "${fieldName}" not found in parent object`);
  }
  const objMatch = body.slice(fieldIdx).match(/z\s*\.\s*object\s*\(\s*\{/);
  if (!objMatch) {
    throw new Error(`field "${fieldName}" is not a z.object — cannot drill in`);
  }
  const start = fieldIdx + objMatch.index! + objMatch[0].length;
  return sliceMatchingBrace(body, start);
}

// Walk from `start` (just past an opening `{`) and return the substring up
// to the matching `}`. Aware of strings and `//`-line comments. We only
// track `{}` for depth — `()` aren't needed because we're already inside
// the object literal and parens within values close on the same line or
// nest cleanly within string-skipped regions.
function sliceMatchingBrace(text: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    // Line comment — skip to newline.
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    // Block comment — skip to */
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    // String literal — skip to matching quote, respecting backslash escapes.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i);
    }
    i += 1;
  }
  throw new Error('unterminated z.object({ ... }) block');
}

// Find the byte offset of `fieldName: ...` at depth 0 of the given body.
// Same string/comment skipping as the brace walker; depth excludes outer
// braces (caller has already entered the object).
function findFieldDeclarationIndex(body: string, fieldName: string): number {
  let depth = 0;
  let i = 0;
  // We're "at depth 0" meaning at the immediate body of the parent object.
  // A field declaration is `^\s*<name>:` at depth 0.
  const declRe = new RegExp(`(^|\\n)\\s*${fieldName}\\s*:`);
  while (i < body.length) {
    const ch = body[i];
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      i += 2;
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\') { i += 2; continue; }
        if (body[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (depth === 0) {
      const slice = body.slice(Math.max(0, i - 1));
      const m = declRe.exec(slice);
      if (m && m.index <= 1) {
        // The match anchored within the current 0-depth window — convert
        // to absolute offset (skip leading whitespace to the identifier).
        const afterWs = slice.search(new RegExp(`\\b${fieldName}\\b`));
        return Math.max(0, i - 1) + afterWs;
      }
    }
    if (ch === '{' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ')') depth -= 1;
    i += 1;
  }
  return -1;
}

function parseFieldNames(body: string): string[] {
  // Walk the body at depth 0 — collect identifiers at the start of a line
  // followed by `:`. Same string/comment skipping. Depth counts `{` and `(`.
  const fields: string[] = [];
  let depth = 0;
  let i = 0;
  let atLineStart = true;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\n') { atLineStart = true; i += 1; continue; }
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      i += 2;
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1; atLineStart = false;
      while (i < body.length) {
        if (body[i] === '\\') { i += 2; continue; }
        if (body[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') { i += 1; continue; }
    if (depth === 0 && atLineStart) {
      // Try to match an identifier followed by colon at this position.
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(body.slice(i));
      if (m) {
        fields.push(m[1]);
        i += m[0].length;
        atLineStart = false;
        continue;
      }
    }
    atLineStart = false;
    if (ch === '{' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ')') depth -= 1;
    i += 1;
  }
  return fields;
}

function parseZodObjectFields(
  contractFile: string,
  path: [string, ...string[]],
): string[] {
  const text = loadContract(contractFile);
  let body = findObjectBody(text, path[0]);
  for (let p = 1; p < path.length; p += 1) {
    body = findNestedObjectBody(body, path[p]);
  }
  return parseFieldNames(body);
}

function diff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: a.filter((x) => !setB.has(x)),
    onlyInB: b.filter((x) => !setA.has(x)),
  };
}

// ─── L2 manifests ───────────────────────────────────────────────────────────
//
// Each constant declares the field set the FE interface is expected to
// expose. The `satisfies Record<keyof FE_INTERFACE, true>` clause makes TS
// fail at compile time if the manifest misses a FE field, OR if the FE
// adds a field that doesn't appear here. The values are arbitrary `true`
// — only the key set carries meaning.

const FE_HEALTH_SNAPSHOT = {
  overall: true, capital: true, liquidity: true, rateRisk: true,
  credit: true, concentration: true, label: true, trend: true,
} satisfies Record<keyof HealthSnapshot, true>;

const FE_TOP_RISK = {
  rank: true, domain: true, priorityScore: true, severity: true,
  finding: true, findingEs: true, dollarImpact: true,
  dollarImpactPct: true, regulatoryRef: true, toolsUsed: true,
} satisfies Record<keyof TopRisk, true>;

const FE_DECISION_QUEUE_ITEM = {
  priority: true, action: true, actionEs: true, expectedImpact: true,
  deadline: true, owner: true, regulatoryRef: true, status: true,
} satisfies Record<keyof DecisionQueueItem, true>;

const FE_ALM_DECISION_OUTPUT = {
  agentId: true, version: true, runId: true, institutionId: true,
  timestamp: true, language: true, healthSnapshot: true, topRisks: true,
  decisionQueue: true, brief: true, briefEs: true, auditTraceId: true,
} satisfies Record<keyof ALMDecisionOutput, true>;

const FE_RISK_ALERT = {
  category: true, severity: true, metric: true, currentValue: true,
  threshold: true, delta: true, trend: true, finding: true,
  findingEs: true, recommendation: true, regulatoryRef: true,
  deadline: true, dedupSeed: true,
} satisfies Record<keyof RiskAlert, true>;

const FE_RISK_MONITOR_OUTPUT = {
  agentId: true, runId: true, institutionId: true, scanKind: true,
  alerts: true, alertCount: true, quietRun: true,
} satisfies Record<keyof RiskMonitorOutput, true>;

const FE_CFO_COPILOT_FOLLOWUP = {
  en: true, es: true,
} satisfies Record<keyof CFOCopilotFollowup, true>;

const FE_CFO_COPILOT_OUTPUT = {
  agentId: true, runId: true, institutionId: true, sessionId: true,
  language: true, message: true, followups: true, toolsCalled: true,
} satisfies Record<keyof CFOCopilotOutput, true>;

const FE_COMMITTEE_RECOMMENDATION = {
  index: true, action: true, owner: true, deadline: true,
  expectedImpact: true, regulatoryRef: true,
} satisfies Record<keyof CommitteeRecommendation, true>;

const FE_REGULATORY_CALENDAR_ITEM = {
  dueDate: true, filing: true, status: true, owner: true, regulatoryRef: true,
} satisfies Record<keyof RegulatoryCalendarItem, true>;

const FE_COMMITTEE_REPORT_OUTPUT = {
  agentId: true, sourceRunId: true, committeeType: true, language: true,
  sections: true, pdfPath: true, wordCount: true, bilingualEsPath: true,
} satisfies Record<keyof CommitteeReportOutput, true>;

const FE_COMMITTEE_REPORT_SECTIONS = {
  executiveSummary: true, financialPosition: true, interestRateRisk: true,
  creditConcentration: true, liquidityRisk: true, peerComparison: true,
  recommendations: true, regulatoryCalendar: true,
} satisfies Record<keyof CommitteeReportOutput['sections'], true>;

const FRONTEND_AGENT_IDS: AgentId[] = [
  'ALM_DECISION', 'COMMITTEE_REPORT', 'RISK_MONITOR', 'CFO_COPILOT',
  'STRESS_TESTING', 'CAPITAL_OPTIMIZER', 'REGULATORY_COMPLIANCE', 'EXAM_PREP',
  'LOAN_PRICING', 'DEPOSIT_STRATEGY', 'PEER_INTELLIGENCE', 'BOARD_NARRATIVE',
];

const FRONTEND_RUN_STATUSES: AgentRunStatus[] = [
  'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT',
];

const FRONTEND_TRIGGER_KINDS: AgentTriggerKind[] = [
  'UPLOAD', 'SCHEDULE', 'USER_QUERY', 'API', 'CHAIN',
];

const FRONTEND_AUDIT_STEP_KINDS: AgentAuditStepKind[] = [
  'RUN_STARTED', 'TOOL_CALL', 'TOOL_RESULT', 'LLM_TURN',
  'CONTRACT_VALIDATION', 'RUN_COMPLETED', 'RUN_FAILED',
];

const FRONTEND_ALERT_SEVERITIES: Severity[] = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW',
];

const FRONTEND_ALERT_STATUSES: AlertStatus[] = [
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED',
];

describe('Contract drift guard: types/agents.ts ↔ schema.prisma', () => {
  it('AgentId matches Prisma enum exactly', () => {
    const prisma = parsePrismaEnum('AgentId');
    expect(FRONTEND_AGENT_IDS.sort()).toEqual(prisma.sort());
  });

  it('AgentRunStatus matches Prisma enum exactly', () => {
    const prisma = parsePrismaEnum('AgentRunStatus');
    expect(FRONTEND_RUN_STATUSES.sort()).toEqual(prisma.sort());
  });

  it('AgentTriggerKind matches Prisma enum exactly', () => {
    const prisma = parsePrismaEnum('AgentTriggerKind');
    expect(FRONTEND_TRIGGER_KINDS.sort()).toEqual(prisma.sort());
  });

  it('AgentAuditStepKind matches Prisma enum exactly', () => {
    const prisma = parsePrismaEnum('AgentAuditStepKind');
    expect(FRONTEND_AUDIT_STEP_KINDS.sort()).toEqual(prisma.sort());
  });

  it('Severity matches Prisma AgentAlertSeverity enum exactly', () => {
    const prisma = parsePrismaEnum('AgentAlertSeverity');
    expect(FRONTEND_ALERT_SEVERITIES.sort()).toEqual(prisma.sort());
  });

  it('AlertStatus matches Prisma AgentAlertStatus enum exactly', () => {
    const prisma = parsePrismaEnum('AgentAlertStatus');
    expect(FRONTEND_ALERT_STATUSES.sort()).toEqual(prisma.sort());
  });

  it('AGENT_LABEL has an entry for every AgentId', () => {
    const prisma = parsePrismaEnum('AgentId');
    for (const id of prisma) {
      expect(AGENT_LABEL).toHaveProperty(id);
      expect(typeof (AGENT_LABEL as Record<string, string>)[id]).toBe('string');
    }
  });

  it('AGENT_LABEL has no extra keys beyond AgentId', () => {
    const prisma = new Set(parsePrismaEnum('AgentId'));
    for (const key of Object.keys(AGENT_LABEL)) {
      expect(prisma.has(key)).toBe(true);
    }
  });
});

// ─── L2: Zod contract-shape drift ───────────────────────────────────────────
//
// For each FE interface that mirrors a BE Zod schema, assert the field sets
// are equal. The manifest above is the FE side (TS-locked via `satisfies`);
// the regex parser produces the BE side from contract source text.
//
// When this fails:
//   • field appears in BE but not FE → add the field to types/agents.ts AND
//     the matching FE_* manifest, OR drop it from BE.
//   • field appears in FE but not BE → remove from FE (and manifest), OR
//     add to the BE Zod schema.

function expectFieldsMatch(
  pair: string,
  feManifest: Record<string, true>,
  beFields: string[],
) {
  const fe = Object.keys(feManifest).sort();
  const be = [...beFields].sort();
  if (fe.length === be.length && fe.every((k, i) => k === be[i])) return;
  const { onlyInA: missingOnBe, onlyInB: missingOnFe } = diff(fe, be);
  const lines: string[] = [`Contract drift in ${pair}:`];
  if (missingOnFe.length > 0) {
    lines.push(
      `  • BE has but FE missing: ${missingOnFe.join(', ')} ` +
      `→ add to types/agents.ts (and the matching FE_* manifest in this test).`,
    );
  }
  if (missingOnBe.length > 0) {
    lines.push(
      `  • FE has but BE missing: ${missingOnBe.join(', ')} ` +
      `→ remove from types/agents.ts (and the manifest), or add to the Zod schema.`,
    );
  }
  throw new Error(lines.join('\n'));
}

describe('Contract drift guard: types/agents.ts ↔ backend Zod contracts', () => {
  it('HealthSnapshot ↔ HealthSnapshotSchema', () => {
    expectFieldsMatch(
      'HealthSnapshot ↔ alm-decision.contracts.ts:HealthSnapshotSchema',
      FE_HEALTH_SNAPSHOT,
      parseZodObjectFields('alm-decision.contracts.ts', ['HealthSnapshotSchema']),
    );
  });

  it('TopRisk ↔ TopRiskSchema', () => {
    expectFieldsMatch(
      'TopRisk ↔ alm-decision.contracts.ts:TopRiskSchema',
      FE_TOP_RISK,
      parseZodObjectFields('alm-decision.contracts.ts', ['TopRiskSchema']),
    );
  });

  it('DecisionQueueItem ↔ DecisionQueueItemSchema', () => {
    expectFieldsMatch(
      'DecisionQueueItem ↔ alm-decision.contracts.ts:DecisionQueueItemSchema',
      FE_DECISION_QUEUE_ITEM,
      parseZodObjectFields('alm-decision.contracts.ts', ['DecisionQueueItemSchema']),
    );
  });

  it('ALMDecisionOutput ↔ ALMDecisionOutputSchema', () => {
    expectFieldsMatch(
      'ALMDecisionOutput ↔ alm-decision.contracts.ts:ALMDecisionOutputSchema',
      FE_ALM_DECISION_OUTPUT,
      parseZodObjectFields('alm-decision.contracts.ts', ['ALMDecisionOutputSchema']),
    );
  });

  it('RiskAlert ↔ RiskAlertSchema', () => {
    expectFieldsMatch(
      'RiskAlert ↔ risk-monitor.contracts.ts:RiskAlertSchema',
      FE_RISK_ALERT,
      parseZodObjectFields('risk-monitor.contracts.ts', ['RiskAlertSchema']),
    );
  });

  it('RiskMonitorOutput ↔ RiskMonitorOutputSchema', () => {
    expectFieldsMatch(
      'RiskMonitorOutput ↔ risk-monitor.contracts.ts:RiskMonitorOutputSchema',
      FE_RISK_MONITOR_OUTPUT,
      parseZodObjectFields('risk-monitor.contracts.ts', ['RiskMonitorOutputSchema']),
    );
  });

  it('CFOCopilotFollowup ↔ CFOCopilotFollowupSchema', () => {
    expectFieldsMatch(
      'CFOCopilotFollowup ↔ cfo-copilot.contracts.ts:CFOCopilotFollowupSchema',
      FE_CFO_COPILOT_FOLLOWUP,
      parseZodObjectFields('cfo-copilot.contracts.ts', ['CFOCopilotFollowupSchema']),
    );
  });

  it('CFOCopilotOutput ↔ CFOCopilotOutputSchema', () => {
    expectFieldsMatch(
      'CFOCopilotOutput ↔ cfo-copilot.contracts.ts:CFOCopilotOutputSchema',
      FE_CFO_COPILOT_OUTPUT,
      parseZodObjectFields('cfo-copilot.contracts.ts', ['CFOCopilotOutputSchema']),
    );
  });

  it('CommitteeRecommendation ↔ RecommendationItemSchema', () => {
    expectFieldsMatch(
      'CommitteeRecommendation ↔ committee-report.contracts.ts:RecommendationItemSchema',
      FE_COMMITTEE_RECOMMENDATION,
      parseZodObjectFields('committee-report.contracts.ts', ['RecommendationItemSchema']),
    );
  });

  it('RegulatoryCalendarItem ↔ CalendarItemSchema', () => {
    expectFieldsMatch(
      'RegulatoryCalendarItem ↔ committee-report.contracts.ts:CalendarItemSchema',
      FE_REGULATORY_CALENDAR_ITEM,
      parseZodObjectFields('committee-report.contracts.ts', ['CalendarItemSchema']),
    );
  });

  it('CommitteeReportOutput ↔ CommitteeReportOutputSchema', () => {
    expectFieldsMatch(
      'CommitteeReportOutput ↔ committee-report.contracts.ts:CommitteeReportOutputSchema',
      FE_COMMITTEE_REPORT_OUTPUT,
      parseZodObjectFields('committee-report.contracts.ts', ['CommitteeReportOutputSchema']),
    );
  });

  it('CommitteeReportOutput.sections ↔ nested z.object inside CommitteeReportOutputSchema', () => {
    expectFieldsMatch(
      'CommitteeReportOutput.sections ↔ committee-report.contracts.ts:CommitteeReportOutputSchema.sections',
      FE_COMMITTEE_REPORT_SECTIONS,
      parseZodObjectFields('committee-report.contracts.ts', [
        'CommitteeReportOutputSchema',
        'sections',
      ]),
    );
  });
});

// ─── L2: unmirrored-agent surface ───────────────────────────────────────────
//
// 8 of the 12 agent contracts have no FE mirror — they're scheduled work
// surfaces (board narrative, exam prep, etc.) or terminal-only flows. This
// spec is informational, not blocking: it records the gap so the next
// contributor wiring the UI for one of these agents sees the surface
// explicitly. When you add the FE types, move the contract to the L2 block
// above and delete its entry here.

const UNMIRRORED_AGENT_CONTRACTS = [
  'stress-testing.contracts.ts',
  'capital-optimizer.contracts.ts',
  'regulatory-compliance.contracts.ts',
  'exam-prep.contracts.ts',
  'loan-pricing.contracts.ts',
  'deposit-strategy.contracts.ts',
  'peer-intelligence.contracts.ts',
  'board-narrative.contracts.ts',
];

describe('Contract drift guard: known FE-unmirrored agent surfaces', () => {
  it('each unmirrored contract still exists on disk (sanity check)', () => {
    for (const file of UNMIRRORED_AGENT_CONTRACTS) {
      expect(() => readFileSync(join(CONTRACTS_DIR, file), 'utf-8')).not.toThrow();
    }
  });

  it.skip(
    `8 agent contracts have no FE mirror yet — ${UNMIRRORED_AGENT_CONTRACTS.join(', ')}. ` +
    'Add FE types in types/agents.ts and a manifest above when wiring these UIs.',
    () => { /* informational placeholder */ },
  );
});

// ─── L3: Zod literal-value drift ────────────────────────────────────────────
//
// L2 catches field-set drift; L3 catches discriminator-value drift. Each
// FE const below is constrained to its FE interface's literal type via
// `: SomeType['field']` — so if the FE interface ever renames the literal
// (e.g. 'alm_decision' → 'alm-decision'), the const fails to typecheck.
// At runtime we extract the BE Zod literal from contract source and assert
// equality. Both halves of the lock must agree.

function parseZodLiteralAt(
  contractFile: string,
  schemaName: string,
  fieldName: string,
): string {
  const text = loadContract(contractFile);
  const body = findObjectBody(text, schemaName);
  // Match `<field>: z.literal('value')` or `z.literal("value")` or backticks.
  // Allows whitespace between every token so multi-line declarations parse.
  const re = new RegExp(
    `\\b${fieldName}\\s*:\\s*z\\s*\\.\\s*literal\\s*\\(\\s*['"\`]([^'"\`]*)['"\`]\\s*\\)`,
  );
  const m = re.exec(body);
  if (!m) {
    throw new Error(
      `${schemaName}.${fieldName} in ${contractFile} is not a z.literal — ` +
      `cannot extract a discriminator value. If the field type changed away ` +
      `from z.literal, drop the corresponding L3 spec; otherwise restore the literal.`,
    );
  }
  return m[1];
}

const FE_ALM_DECISION_AGENT_ID: ALMDecisionOutput['agentId'] = 'alm_decision';
const FE_ALM_DECISION_VERSION: ALMDecisionOutput['version'] = '2.0';
const FE_RISK_MONITOR_AGENT_ID: RiskMonitorOutput['agentId'] = 'risk_monitor';
const FE_CFO_COPILOT_AGENT_ID: CFOCopilotOutput['agentId'] = 'cfo_copilot';
const FE_COMMITTEE_REPORT_AGENT_ID: CommitteeReportOutput['agentId'] = 'committee_report';
const FE_DECISION_QUEUE_STATUS: DecisionQueueItem['status'] = 'PENDING';

describe('Contract drift guard: Zod literal-value alignment (L3)', () => {
  it('ALMDecisionOutput.agentId discriminator matches ALMDecisionOutputSchema.agentId', () => {
    expect(
      parseZodLiteralAt('alm-decision.contracts.ts', 'ALMDecisionOutputSchema', 'agentId'),
    ).toBe(FE_ALM_DECISION_AGENT_ID);
  });

  it('ALMDecisionOutput.version literal matches ALMDecisionOutputSchema.version', () => {
    expect(
      parseZodLiteralAt('alm-decision.contracts.ts', 'ALMDecisionOutputSchema', 'version'),
    ).toBe(FE_ALM_DECISION_VERSION);
  });

  it('RiskMonitorOutput.agentId discriminator matches RiskMonitorOutputSchema.agentId', () => {
    expect(
      parseZodLiteralAt('risk-monitor.contracts.ts', 'RiskMonitorOutputSchema', 'agentId'),
    ).toBe(FE_RISK_MONITOR_AGENT_ID);
  });

  it('CFOCopilotOutput.agentId discriminator matches CFOCopilotOutputSchema.agentId', () => {
    expect(
      parseZodLiteralAt('cfo-copilot.contracts.ts', 'CFOCopilotOutputSchema', 'agentId'),
    ).toBe(FE_CFO_COPILOT_AGENT_ID);
  });

  it('CommitteeReportOutput.agentId discriminator matches CommitteeReportOutputSchema.agentId', () => {
    expect(
      parseZodLiteralAt('committee-report.contracts.ts', 'CommitteeReportOutputSchema', 'agentId'),
    ).toBe(FE_COMMITTEE_REPORT_AGENT_ID);
  });

  it('DecisionQueueItem.status literal matches DecisionQueueItemSchema.status', () => {
    expect(
      parseZodLiteralAt('alm-decision.contracts.ts', 'DecisionQueueItemSchema', 'status'),
    ).toBe(FE_DECISION_QUEUE_STATUS);
  });
});
