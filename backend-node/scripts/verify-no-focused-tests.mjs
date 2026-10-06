#!/usr/bin/env node
// scripts/verify-no-focused-tests.mjs
//
// Blocks the most insidious silent-green there is: a committed
// `it.only(...)` / `describe.only(...)` (or `fit`/`fdescribe`) makes
// jest/vitest run ONLY that test, SKIP the entire rest of the file, and
// still EXIT 0. CI goes green while the suite it was supposed to protect
// never runs. It is the test-layer analog of D1's phantom zero — a pass
// that means nothing. A stray `.only` left in a commit can mask hundreds
// of failing assertions indefinitely.
//
// This gate scans committed spec files (*.spec.ts / *.e2e-spec.ts) and:
//   • FOCUSED  (`.only(` / `fit(` / `fdescribe(`) → ALWAYS BLOCKING.
//       Never legitimate in a commit; not baseline-able. Remove it.
//   • SKIPPED  (`.skip(` / `xit(` / `xdescribe(`) → blocking unless the
//       file is on the baseline with a reason (deliberate skips happen,
//       but they must be intentional + documented, never accidental).
//
// Detection requires the CALL form (`only(` / `skip(`), so the legitimate
// dynamic idiom `const d = cond ? describe : describe.skip;` (a value, no
// call — used in agent-eval/cross-agent-regression.spec.ts) is NOT flagged.
// Comments are stripped first, so a comment mentioning `.only` is ignored.
//
// Exit codes:
//   0 — no focused tests; skipped tests only where baselined; no stale entries
//   1 — a focused test exists, or an unbaselined/grown skip, or a stale entry
//
// Skip with VERIFY_NO_FOCUSED_TESTS_SKIP=1 (emergency escape).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCAN_ROOTS = ['src', 'test'].map((d) => join(REPO_ROOT, d));

// CALL-form only — `.only(` / `fit(` etc. The value idiom `: describe.skip;`
// (no paren) is intentionally NOT matched.
const FOCUSED =
  /\b(?:it|test|describe|context|suite|xit|xtest|xdescribe)\s*\.\s*only\s*\(|\b(?:fit|fdescribe)\s*\(/g;
const SKIPPED =
  /\b(?:it|test|describe|context|suite)\s*\.\s*skip\s*\(|\b(?:xit|xdescribe|xtest)\s*\(/g;

// Single-pass: blank string literals to "" and drop // and /* */ comments,
// processed left-to-right so a `//` inside a string, or a string inside a
// comment, is handled correctly. Blanking string CONTENT (not just comments)
// prevents a literal that merely CONTAINS `it.only(` / `.skip(` (e.g. a test
// description or a meta-test about focused tests) from reading as a real
// focused/skipped test — the string-literal false-positive class the
// 2026-06-07 gate audit flagged. This is the reference impl; verify-d1 +
// verify-no-silent-catch should adopt the same when next touched.
function stripComments(content) {
  return content.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m, str) => (str ? '""' : ''),
  );
}

export function countFocusSkip(content) {
  const code = stripComments(content);
  const focused = (code.match(FOCUSED) || []).length;
  const skipped = (code.match(SKIPPED) || []).length;
  return { focused, skipped };
}

// ─── Baseline (deliberate skips only — focused is never baseline-able) ────
// relPath (from repo root) → known deliberate-skip count, each with a reason.
// Locked 2026-06-07: empty. 0 focused, 0 call-form skips across all specs.
const BASELINE_SKIPS = {
  // (empty — the only `.skip` in the tree is the value idiom
  //  `goldens ? describe : describe.skip` in
  //  src/agent-eval/cross-agent-regression.spec.ts, which is not a call
  //  and is correctly not flagged.)
};

// ─── Walker ────────────────────────────────────────────────────────────
function walkSpecs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkSpecs(full));
    } else if (entry.endsWith('.spec.ts') || entry.endsWith('.e2e-spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ─── Classifier ──────────────────────────────────────────────────────────
//   { status: 'none' }
//   { status: 'focused', focused }                  — ALWAYS blocking
//   { status: 'skip-baselined', skipped, baseline }
//   { status: 'skip-violation', skipped, baseline } — unbaselined / grew
export function classify(content, relPath) {
  const { focused, skipped } = countFocusSkip(content);
  if (focused > 0) return { status: 'focused', focused };
  if (skipped > 0) {
    const baseline = BASELINE_SKIPS[relPath];
    if (baseline !== undefined && skipped <= baseline) {
      return { status: 'skip-baselined', skipped, baseline };
    }
    return { status: 'skip-violation', skipped, baseline: baseline || 0 };
  }
  return { status: 'none' };
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_NO_FOCUSED_TESTS_SKIP === '1') {
    console.log('verify-no-focused-tests: skipped (VERIFY_NO_FOCUSED_TESTS_SKIP=1)');
    process.exit(0);
  }

  const files = SCAN_ROOTS.flatMap(walkSpecs);
  const focused = [];
  const skipViolations = [];
  let skipBaselined = 0;
  const baselineHits = new Set();

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const result = classify(readFileSync(file, 'utf-8'), rel);
    if (result.status === 'focused') focused.push({ rel, n: result.focused });
    else if (result.status === 'skip-violation')
      skipViolations.push({ rel, n: result.skipped, baseline: result.baseline });
    else if (result.status === 'skip-baselined') {
      skipBaselined++;
      baselineHits.add(rel);
    }
  }

  const stale = Object.keys(BASELINE_SKIPS).filter((k) => !baselineHits.has(k));

  console.log(`verify-no-focused-tests: scanned ${files.length} spec file(s)`);
  console.log(
    `  ${focused.length} focused · ${skipViolations.length} unbaselined-skip · ${skipBaselined} baselined-skip`,
  );

  let failed = false;
  if (focused.length > 0) {
    console.log('\n❌ Focused test(s) — these SKIP THE REST OF THE FILE while CI stays green (BLOCKING):');
    for (const f of focused) console.log(`  - ${f.rel}  [${f.n} .only/fit/fdescribe]`);
    console.log('\n  Remove the .only/fit/fdescribe. A focused test in a commit is always a mistake.');
    failed = true;
  }
  if (skipViolations.length > 0) {
    console.log('\n❌ Unbaselined skipped test(s) (BLOCKING):');
    for (const s of skipViolations)
      console.log(`  - ${s.rel}  [${s.n} .skip/xit/xdescribe, baseline ${s.baseline}]`);
    console.log('\n  Un-skip it, or — if the skip is deliberate — add the file to');
    console.log('  BASELINE_SKIPS in this script with a one-line reason.');
    failed = true;
  }
  if (stale.length > 0) {
    console.log('\n✓→ Stale BASELINE_SKIPS (no longer skipping — remove the entry):');
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n✓ no-focused-tests: no focused tests; no accidental skips.');
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'it.only(...) → focused (blocking)',
      content: `it.only('x', () => {});`,
      rel: 'src/a.spec.ts',
      expected: 'focused',
    },
    {
      name: 'describe.only(...) → focused',
      content: `describe.only('suite', () => {});`,
      rel: 'src/b.spec.ts',
      expected: 'focused',
    },
    {
      name: 'fit(...) → focused',
      content: `fit('x', () => {});`,
      rel: 'src/c.spec.ts',
      expected: 'focused',
    },
    {
      name: 'it.skip(...) → skip-violation (no baseline)',
      content: `it.skip('x', () => {});`,
      rel: 'src/d.spec.ts',
      expected: 'skip-violation',
    },
    {
      name: 'xit(...) → skip-violation',
      content: `xit('x', () => {});`,
      rel: 'src/e.spec.ts',
      expected: 'skip-violation',
    },
    {
      name: 'value idiom `? describe : describe.skip` (no call) → none',
      content: `const d = cond ? describe : describe.skip;\nd('suite', () => {});`,
      rel: 'src/f.spec.ts',
      expected: 'none',
    },
    {
      name: 'clean spec → none',
      content: `describe('s', () => { it('works', () => {}); });`,
      rel: 'src/g.spec.ts',
      expected: 'none',
    },
    {
      name: '.only inside a // comment → none (stripped)',
      content: `// don't use it.only( here\nit('x', () => {});`,
      rel: 'src/h.spec.ts',
      expected: 'none',
    },
    {
      name: '.only inside a block comment → none',
      content: `/* it.only('old', ...) was removed */\nit('x', () => {});`,
      rel: 'src/i.spec.ts',
      expected: 'none',
    },
    {
      name: 'focused takes precedence over skip in same file',
      content: `it.skip('a', ()=>{});\nit.only('b', ()=>{});`,
      rel: 'src/j.spec.ts',
      expected: 'focused',
    },
    {
      name: 'spaced form  describe . only (  → focused',
      content: `describe . only ('s', () => {});`,
      rel: 'src/k.spec.ts',
      expected: 'focused',
    },
    {
      name: 'it.only( inside a STRING literal → none (string blanked, not a real focus)',
      content: `it('documents the it.only( hazard', () => { expect(lint('it.only(')).toBe(false); });`,
      rel: 'src/l.spec.ts',
      expected: 'none',
    },
    {
      name: '.skip( inside a string literal → none',
      content: `const msg = 'never commit it.skip( in a spec';\nit('x', () => {});`,
      rel: 'src/m.spec.ts',
      expected: 'none',
    },
    {
      name: 'xit.only( (nonsensical skip+focus) → focused (caught after audit fix)',
      content: `xit.only('x', () => {});`,
      rel: 'src/n.spec.ts',
      expected: 'focused',
    },
    {
      name: 'real it.only on a line after a string mentioning it → focused (string blanked, code survives)',
      content: `const note = 'avoid it.only(';\nit.only('real', () => {});`,
      rel: 'src/o.spec.ts',
      expected: 'focused',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const r = classify(c.content, c.rel);
    if (r.status === c.expected) pass++;
    else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${r.status}`);
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
