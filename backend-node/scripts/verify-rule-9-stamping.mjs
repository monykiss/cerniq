#!/usr/bin/env node
// scripts/verify-rule-9-stamping.mjs
//
// Enforces KLYTICS Audit Discipline Rule 9 (prompt + cost provenance on
// every LLM call). See `docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` §1
// Rule 9 for normative text; this script is the CI lock that prevents
// new LLM-calling code from shipping without stamping infrastructure.
//
// Rule of thumb:
//   Any .ts file that calls `messages.create` / `messages.stream` on
//   the Anthropic SDK MUST either:
//     (a) import + use `computePromptVersion` (the canonical stamper), OR
//     (b) carry a `// verify:rule-9-skip — <reason>` comment in the
//         first 50 lines (ad-hoc opt-out, rare), OR
//     (c) be listed in BASELINE_UNSTAMPED below with a one-line reason
//         and a follow-up direction (the chip-away surface).
//
// Why baseline-with-rationale rather than skip-commenting in src/:
//   centralizing the exception data in this script keeps the gap visible
//   as a single TODO surface rather than scattering 6 skip comments
//   across peer-owned source files. Mirrors `verify-no-orphan-spec.mjs`
//   pattern; see the discussion there for the design tradeoffs.
//
// Exit codes:
//   0 — all LLM-calling files account for Rule 9
//   1 — unstamped file found (BLOCKING) or stale baseline entry
//
// Skip the script entirely with VERIFY_RULE_9_SKIP=1 (escape hatch for
// emergency commits; don't make a habit of it).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

// ─── Patterns ──────────────────────────────────────────────────────────
// Detect Anthropic SDK call sites. Both messages.create (sync) and
// messages.stream (streaming) are covered. The `@anthropic-ai/sdk`
// import alone is NOT enough — a file that imports but only re-exports
// types shouldn't count.
const ANTHROPIC_CALL_PATTERN = /\bmessages\s*\.\s*(create|stream)\b/;

// Detect stamping. computePromptVersion is the canonical helper from
// `src/alm/analyst/prompt-version.ts`. A path import or a usage both
// count — caller-side use is what matters.
const STAMPING_PATTERN =
  /\bcomputePromptVersion\b|['"`][^'"`]*analyst\/prompt-version['"`]/;

// Skip-comment syntax (mirrors verify-no-orphan-spec).
const SKIP_COMMENT = /\/\/\s*verify:rule-9-skip\s*—\s*(.+)/;

// Strip comments before pattern-matching to avoid false positives from
// JSDoc that mentions `messages.create` in passing (e.g. `prompt-version.ts`
// references the SDK signature in its `Full system prompt text passed to
// messages.create({ system })` JSDoc but is not itself a caller).
function stripComments(content) {
  // Block comments (/* ... */ and /** ... */) — non-greedy, multi-line
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments — drop everything from // to end-of-line
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

// ─── Baseline ──────────────────────────────────────────────────────────
// Known unstamped LLM-calling files. Each entry MUST include a
// one-line reason and a target / follow-up direction. Chip away over
// time — when a file gets stamped, remove its entry here and the
// stale-baseline detector flags this script for cleanup.
const BASELINE_UNSTAMPED = {
  'ai-advisor/ai-advisor.service.ts':
    'blocked on peer IDOR-fix claim (sid=8f694e66); promote to stamped once that wave settles',
  'agents/runner/llm-bridge.service.ts':
    'agent runner core; stamp once LLMTurnResponse shape extended with promptVersion + usage fields (cascades to all agents)',
  'alm/alm-advisor.service.ts':
    'legacy advisor surface; retire OR migrate-then-stamp; check with peer wave before touching',
  'ai/ingest/nl-ingest.service.ts':
    'NL ingestion path; stamp once ingest pipeline lineage is wired into the analysis-run row',
  'ai/regulatory/impact-extractor.service.ts':
    'regulatory impact extraction; lower-priority path, stamp on next wave when regulatory pipeline is touched',
};

// ─── Walker ────────────────────────────────────────────────────────────
function walkTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ─── Classifier ────────────────────────────────────────────────────────
// Pure function — takes content + rel-path, returns one of:
//   { status: 'none' }           — no Anthropic call detected
//   { status: 'stamped' }        — stamping found
//   { status: 'skipped', reason } — skip-comment in first 50 lines
//   { status: 'baselined', reason } — listed in BASELINE_UNSTAMPED
//   { status: 'unstamped' }      — BLOCKING
export function classify(content, relPath) {
  // Strip comments BEFORE matching the Anthropic call pattern — otherwise
  // a JSDoc that references `messages.create({ system })` in passing
  // (as `prompt-version.ts` does) gets misclassified as a caller. The
  // stamping pattern uses the stripped form too, since
  // `computePromptVersion` in a comment isn't real stamping.
  const codeOnly = stripComments(content);
  const hasAnthropicCall = ANTHROPIC_CALL_PATTERN.test(codeOnly);
  if (!hasAnthropicCall) return { status: 'none' };

  // Skip-comment detection uses ORIGINAL content because the skip
  // comment IS a comment; stripping it before matching would erase it.
  const head = content.split('\n').slice(0, 50).join('\n');
  const skipMatch = head.match(SKIP_COMMENT);
  if (skipMatch) {
    const reason = skipMatch[1].trim();
    return { status: 'skipped', reason };
  }

  if (STAMPING_PATTERN.test(codeOnly)) {
    return { status: 'stamped' };
  }

  if (relPath in BASELINE_UNSTAMPED) {
    return { status: 'baselined', reason: BASELINE_UNSTAMPED[relPath] };
  }

  return { status: 'unstamped' };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_RULE_9_SKIP === '1') {
    console.log('verify-rule-9-stamping: skipped (VERIFY_RULE_9_SKIP=1)');
    process.exit(0);
  }

  const files = walkTs(SRC_ROOT);
  const llmCalling = [];
  let stamped = 0;
  let skipped = 0;
  let baselined = 0;
  const unstamped = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;

    llmCalling.push({ file: rel, ...result });
    if (result.status === 'stamped') stamped++;
    else if (result.status === 'skipped') skipped++;
    else if (result.status === 'baselined') baselined++;
    else if (result.status === 'unstamped') unstamped.push(rel);
  }

  // Stale-baseline detection: entries that didn't match any file
  const matchedBaselineKeys = new Set(
    llmCalling.filter((r) => r.status === 'baselined').map((r) => r.file),
  );
  const stale = Object.keys(BASELINE_UNSTAMPED).filter(
    (k) => !matchedBaselineKeys.has(k),
  );

  console.log(
    `verify-rule-9-stamping: scanned ${files.length} src files, found ${llmCalling.length} LLM-calling files`,
  );
  console.log(
    `  ${stamped} stamped · ${skipped} skip-commented · ${baselined} baselined · ${unstamped.length} unstamped`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n⚠ Stale BASELINE_UNSTAMPED entries (no LLM-calling file matches — remove):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (unstamped.length > 0) {
    console.log('\n❌ Unstamped LLM-calling files (BLOCKING):');
    for (const f of unstamped) console.log(`  - ${f}`);
    console.log('\n  Fix: import + use `computePromptVersion` from');
    console.log('       `src/alm/analyst/prompt-version.ts`. Mirror the');
    console.log('       pattern in `src/alm/alm-analyst.service.ts:425-431`.');
    console.log('       OR add to BASELINE_UNSTAMPED in this script with a');
    console.log('       one-line reason + follow-up direction.');
    console.log('       OR add `// verify:rule-9-skip — <reason>` in the');
    console.log('       first 50 lines of the offending file.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n✓ All LLM-calling files account for Rule 9.');
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'file with no Anthropic call → none',
      content: 'export function foo() { return 42; }',
      rel: 'foo.ts',
      expected: 'none',
    },
    {
      name: 'file with messages.create + computePromptVersion → stamped',
      content: `
        import { computePromptVersion } from './analyst/prompt-version';
        const v = computePromptVersion({ model: 'x', systemPrompt: 'y' });
        await client.messages.create({ model: 'x' });
      `,
      rel: 'svc.ts',
      expected: 'stamped',
    },
    {
      name: 'file with messages.stream + computePromptVersion → stamped',
      content: `
        import { computePromptVersion } from './analyst/prompt-version';
        await client.messages.stream({});
      `,
      rel: 'svc.ts',
      expected: 'stamped',
    },
    {
      name: 'file with messages.create alone → unstamped',
      content: `await client.messages.create({ model: 'x' });`,
      rel: 'naked.ts',
      expected: 'unstamped',
    },
    {
      name: 'file with messages.create + skip comment → skipped',
      content: `// verify:rule-9-skip — internal eval harness, not production output\nawait client.messages.create({});`,
      rel: 'eval.ts',
      expected: 'skipped',
    },
    {
      name: 'file matching BASELINE_UNSTAMPED → baselined',
      content: `await client.messages.create({});`,
      rel: 'ai-advisor/ai-advisor.service.ts',
      expected: 'baselined',
    },
    {
      name: 'skip comment without em-dash + reason → does NOT match (must have reason)',
      content: `// verify:rule-9-skip\nawait client.messages.create({});`,
      rel: 'no-reason.ts',
      expected: 'unstamped',
    },
    {
      name: 'path-only import of prompt-version counts as stamping',
      content: `
        import './analyst/prompt-version';
        await client.messages.create({});
      `,
      rel: 'path-import.ts',
      expected: 'stamped',
    },
    {
      name: 'skip comment past line 50 does NOT count',
      content:
        Array(55).fill('// noise').join('\n') +
        '\n// verify:rule-9-skip — too late\nawait client.messages.create({});',
      rel: 'late-skip.ts',
      expected: 'unstamped',
    },
    {
      name: 'JSDoc that mentions messages.create is NOT a caller (helper file)',
      content: `
        /** Full system prompt text passed to \`messages.create({ system })\`. */
        export function computePromptVersion() { return 'abc'; }
      `,
      rel: 'analyst/prompt-version.ts',
      expected: 'none',
    },
    {
      name: 'line comment // messages.create is NOT a caller',
      content: `
        // see anthropic docs for messages.create
        export const x = 42;
      `,
      rel: 'docs.ts',
      expected: 'none',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const result = classify(c.content, c.rel);
    if (result.status === c.expected) {
      pass++;
    } else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${result.status}`);
    }
  }
  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
