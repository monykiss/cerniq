#!/usr/bin/env node
// scripts/verify-rule-11-any-rationale.mjs
//
// Enforces KLYTICS Audit Discipline Rule 11 (no type-loophole without a
// rationale). See `docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` §1 Rule 11
// for normative text; this script is the CI lock that prevents the
// untyped escape hatch from creeping into either subproject without an
// explicit, reviewer-visible justification.
//
// Rule of thumb:
//   In production TypeScript (backend-node/src and frontend/{app,components,hooks,lib}),
//   the bare untyped escape hatch in three forms (annotation, cast, generic
//   parameter) is allowed only when the IMMEDIATELY-PRECEDING line is
//   `// type-rationale: <reason>`. Exceptions: default-generic positions
//   (`<T = …>`) and rest-args (`...args: …[]`) are allowed without rationale
//   because they document intent rather than masking it.
//
// Why a separate verifier instead of an ESLint rule:
//   `@typescript-eslint/no-explicit-any` is binary — it cannot express "this
//   one is justified". A custom ESLint rule would work but the verifier
//   script gives us the same enforcement with a single, auditable file +
//   a chip-away baseline. Once each subtree's unrationalized count drops
//   to zero, ESLint can layer the strict rule.
//
// Baseline model — count-based per file (chip-away):
//   Each backend-node file currently carrying unrationalized hits is
//   listed in BASELINE_COUNTS with its current count. CI passes if a
//   file's count is <= the baseline. Growing a file's count fails CI.
//   Shrinking it to zero (or below) is the desired direction; once a
//   file hits zero, drop its entry and the stale-baseline detector
//   flags this script for cleanup.
//
// Exit codes:
//   0 — every file's unrationalized count is at or below its baseline
//   1 — file count exceeded baseline, OR new file (not in baseline) has
//       unrationalized hits, OR stale baseline entry
//
// Skip with VERIFY_RULE_11_SKIP=1 (escape hatch; don't make a habit).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '..');
const REPO_ROOT = join(BACKEND_ROOT, '..');
const BACKEND_SRC = join(BACKEND_ROOT, 'src');
const FRONTEND_ROOT = join(REPO_ROOT, 'frontend');
const FRONTEND_TREES = ['app', 'components', 'hooks', 'lib'].map((d) =>
  join(FRONTEND_ROOT, d),
);

// ─── Token-detection helpers ───────────────────────────────────────────
// Top-of-file JSDoc must NEVER contain the literal token we are scanning
// for — otherwise this script would self-trigger on its own production
// scan. We refer to it only as "the untyped escape hatch" in prose.
//
// Patterns (after stripComments + per-line context):
//   :ANY\b         → annotation form, e.g. `foo: ANY` or `(x: ANY)` (ANY = the keyword)
//   as ANY\b       → cast form
//   <ANY>          → single-arg generic application
//   <ANY,          → multi-arg generic application, first slot
//   ,\s*ANY>       → multi-arg generic application, later slot
//   ,\s*ANY,       → multi-arg generic application, middle slot
//
// Allowed (do NOT count as violations even without rationale):
//   <T = ANY>           → default generic parameter — documents intent
//   ...rest: ANY[]      → rest-args annotation — required by TS for variadic functions
//   <T extends ANY[]>   → constraint-with-array — variadic generic constraint
//
// We construct the token at runtime from two halves so this JSDoc itself
// stays clean of the literal trigger.
const TOK = 'a' + 'ny'; // intentional split — keeps this file from self-flagging

const HIT_PATTERNS = [
  new RegExp(`:\\s*${TOK}\\b(?!\\s*\\[\\s*\\])`), // `: any` but NOT `: any[]` in rest-args context (handled below)
  new RegExp(`\\bas\\s+${TOK}\\b`),
  new RegExp(`<\\s*${TOK}\\s*>`),
  new RegExp(`<\\s*${TOK}\\s*,`),
  new RegExp(`,\\s*${TOK}\\s*>`),
  new RegExp(`,\\s*${TOK}\\s*,`),
];

const REST_ARGS_PATTERN = new RegExp(`\\.\\.\\.\\w+\\s*:\\s*${TOK}\\b`);
const DEFAULT_GENERIC_PATTERN = new RegExp(
  `<\\s*\\w+(?:\\s+extends\\s+[^=>]+?)?\\s*=\\s*${TOK}[\\s,>]`,
);
const RATIONALE_PATTERN = /^\s*\/\/\s*type-rationale\s*:\s*\S+/;

function stripComments(content) {
  let s = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // For line comments, blank out everything after `//` but keep the line so
  // line numbers are preserved.
  s = s
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      // Keep the leading // marker so RATIONALE_PATTERN can still match the original lines.
      return line.slice(0, idx);
    })
    .join('\n');
  return s;
}

// Per-line classifier — returns array of { line, kind } for unrationalized hits.
export function findUnrationalizedHits(content) {
  const origLines = content.split('\n');
  const stripped = stripComments(content);
  const codeLines = stripped.split('\n');
  const hits = [];

  for (let i = 0; i < codeLines.length; i++) {
    const codeLine = codeLines[i];
    if (codeLine.trim().length === 0) continue;

    // Detect any-on-this-line. We work from the stripped (code-only) line.
    const hasHit = HIT_PATTERNS.some((re) => re.test(codeLine));
    if (!hasHit) continue;

    // Allowed forms — skip if THIS line is purely a default-generic / rest-arg.
    // We're permissive: as long as at least one allowed form matches AND
    // no unallowed form would match if we masked the allowed one out, it's clean.
    const allowedRest = REST_ARGS_PATTERN.test(codeLine);
    const allowedDefault = DEFAULT_GENERIC_PATTERN.test(codeLine);

    // Mask allowed occurrences with a placeholder, then re-test for any remaining hits.
    let masked = codeLine;
    if (allowedRest) {
      masked = masked.replace(REST_ARGS_PATTERN, '_REST_ARG_');
    }
    if (allowedDefault) {
      masked = masked.replace(DEFAULT_GENERIC_PATTERN, '_DEFAULT_GEN_ ');
    }
    const stillHasHit = HIT_PATTERNS.some((re) => re.test(masked));
    if (!stillHasHit) continue;

    // Check the IMMEDIATELY preceding ORIGINAL line for the rationale marker.
    const prevOrig = i > 0 ? origLines[i - 1] : '';
    if (RATIONALE_PATTERN.test(prevOrig)) continue;

    hits.push({ line: i + 1, snippet: codeLine.trim().slice(0, 120) });
  }
  return hits;
}

// ─── Baseline ──────────────────────────────────────────────────────────
// Per-file unrationalized-hit count. Keys are paths relative to REPO_ROOT.
// Loaded from the sidecar `verify-rule-11-baseline.json` so the baseline
// can be re-baked without touching this script's SHA. Counts can only
// shrink — growth fails CI. When a file reaches 0, remove the entry; the
// stale-baseline detector will surface entries that no longer apply.
//
// Rebake (after a chip-away pass):
//   VERIFY_RULE_11_SNAPSHOT=1 node scripts/verify-rule-11-any-rationale.mjs > scripts/verify-rule-11-baseline.json
const BASELINE_PATH = join(__dirname, 'verify-rule-11-baseline.json');
const BASELINE_COUNTS = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  : {};

// ─── Walker ────────────────────────────────────────────────────────────
function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist')
      continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.spec.tsx') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function collectTrees() {
  const trees = [BACKEND_SRC, ...FRONTEND_TREES];
  const out = [];
  for (const t of trees) out.push(...walkTs(t));
  return out;
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_RULE_11_SKIP === '1') {
    console.log(
      'verify-rule-11-any-rationale: skipped (VERIFY_RULE_11_SKIP=1)',
    );
    process.exit(0);
  }

  const files = collectTrees();
  const perFile = new Map(); // relPath → unrationalized count
  let totalHits = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const hits = findUnrationalizedHits(content);
    if (hits.length > 0) {
      const rel = relative(REPO_ROOT, file);
      perFile.set(rel, hits.length);
      totalHits += hits.length;
    }
  }

  if (process.env.VERIFY_RULE_11_SNAPSHOT === '1') {
    // Emit a JSON snapshot of the per-file counts. Pipe to a file and
    // paste into BASELINE_COUNTS to bake.
    const obj = {};
    for (const [k, v] of [...perFile.entries()].sort()) obj[k] = v;
    console.log(JSON.stringify(obj, null, 2));
    process.exit(0);
  }

  // Compare against baseline.
  const newOffenders = []; // file paths not in baseline that have hits
  const overGrown = []; // files that grew

  for (const [file, count] of perFile.entries()) {
    if (!(file in BASELINE_COUNTS)) {
      newOffenders.push({ file, count });
      continue;
    }
    if (count > BASELINE_COUNTS[file]) {
      overGrown.push({ file, current: count, baseline: BASELINE_COUNTS[file] });
    }
  }

  const stale = Object.keys(BASELINE_COUNTS).filter((k) => !perFile.has(k));

  console.log(
    `verify-rule-11-any-rationale: scanned ${files.length} file(s), ${perFile.size} have unrationalized hits (${totalHits} total)`,
  );
  console.log(
    `  ${newOffenders.length} new offender(s) · ${overGrown.length} regression(s) · ${stale.length} stale baseline entry/entries`,
  );

  let failed = false;
  if (newOffenders.length > 0) {
    console.log(
      '\n❌ Files with unrationalized hits not present in BASELINE_COUNTS (BLOCKING):',
    );
    for (const { file, count } of newOffenders.slice(0, 20)) {
      console.log(`  - ${file} (${count})`);
    }
    if (newOffenders.length > 20)
      console.log(`  … and ${newOffenders.length - 20} more`);
    console.log(
      '\n  Fix: either type the untyped escape hatch, or add a `// type-rationale: <reason>`',
    );
    console.log('       comment on the IMMEDIATELY preceding line, or run');
    console.log(
      '       `VERIFY_RULE_11_SNAPSHOT=1 node scripts/verify-rule-11-any-rationale.mjs`',
    );
    console.log(
      '       and paste output into BASELINE_COUNTS to bake (chip-away discipline).',
    );
    failed = true;
  }
  if (overGrown.length > 0) {
    console.log(
      '\n❌ Files whose unrationalized count exceeds baseline (BLOCKING):',
    );
    for (const { file, current, baseline } of overGrown) {
      console.log(`  - ${file}: ${current} > baseline ${baseline}`);
    }
    failed = true;
  }
  if (stale.length > 0) {
    console.log(
      '\n⚠ Stale BASELINE_COUNTS entries (file no longer offends — remove for credit):',
    );
    for (const k of stale.slice(0, 10)) console.log(`  - ${k}`);
    if (stale.length > 10) console.log(`  … and ${stale.length - 10} more`);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n✓ Rule 11 (type-rationale): all files at or below baseline.');
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const A = TOK; // local alias for brevity in fixtures
  const cases = [
    {
      name: 'plain code, no hits → 0',
      content: `export function foo(x: number): string { return x.toString(); }`,
      expected: 0,
    },
    {
      name: 'bare ANY annotation, no rationale → 1',
      content: `export function foo(x: ${A}): number { return 1; }`,
      expected: 1,
    },
    {
      name: 'bare ANY with rationale on the previous line → 0',
      content: [
        '// type-rationale: prisma require() returns untyped row',
        `export function foo(x: ${A}): number { return 1; }`,
      ].join('\n'),
      expected: 0,
    },
    {
      name: 'rationale TWO lines above (not immediate) → 1',
      content: [
        '// type-rationale: stale',
        '// (some other line)',
        `export function foo(x: ${A}): number { return 1; }`,
      ].join('\n'),
      expected: 1,
    },
    {
      name: 'rest-arg annotation → 0 (allowed)',
      content: `export function foo(...args: ${A}[]): void {}`,
      expected: 0,
    },
    {
      name: 'default generic <T = ANY> → 0 (allowed)',
      content: `export function foo<T = ${A}>(x: T): T { return x; }`,
      expected: 0,
    },
    {
      name: 'cast form `as ANY` no rationale → 1',
      content: `const x = (something as ${A}).foo;`,
      expected: 1,
    },
    {
      name: 'cast form `as ANY` with rationale → 0',
      content: [
        '// type-rationale: third-party SDK has no types',
        `const x = (something as ${A}).foo;`,
      ].join('\n'),
      expected: 0,
    },
    {
      name: 'generic application <ANY> no rationale → 1',
      content: `const x: Array<${A}> = [];`,
      expected: 1,
    },
    {
      name: 'ANY in a JSDoc → 0 (stripComments)',
      content: `/** Returns ${A}. */\nexport const x = 1;`,
      expected: 0,
    },
    {
      name: 'ANY in a // line comment → 0 (stripComments)',
      content: `// uses ${A} for legacy compat\nexport const x = 1;`,
      expected: 0,
    },
    {
      name: 'extends ANY[] constraint default → 0 (allowed)',
      content: `export function foo<T extends ${A}[]>(x: T): T { return x; }`,
      expected: 0,
    },
    {
      name: 'word containing "any" (manyXxx) → 0 (no boundary match)',
      content: `const manyThings = 1;`,
      expected: 0,
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const hits = findUnrationalizedHits(c.content);
    if (hits.length === c.expected) {
      pass++;
    } else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(
        `  expected ${c.expected}, got ${hits.length}: ${JSON.stringify(hits)}`,
      );
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
