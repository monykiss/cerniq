#!/usr/bin/env node
// scripts/verify-no-phantom-balance-total.mjs
//
// Enforces the most load-bearing case of the CerniQ D1 doctrine (never silent
// zeros / never a fabricated fallback — see src/alm/reports/data-gap.ts): a
// balance-sheet TOTAL (the sum of item balances) must NEVER fall back to a
// hardcoded magic number when the balance sheet is empty.
//
// THE HARM THIS STOPS — the `|| 445` / `|| 385` phantom:
//   const totalAssets = items.filter(i => i.category==='asset')
//     .reduce((s,i) => s + i.balance, 0) || 445;   // ← fabricates $445M
//   const totalLiabilities = ...reduce(...balance, 0) || 385;  // ← $385M
// These two constants ($445M assets / $385M liabilities) are the CerniQ demo
// institution's totals. When an institution has NO balance sheet, the sum is 0,
// the `|| 445` kicks in, and EVERY downstream metric — LCR, HQLA, DFAST stress
// capital, CAMEL composite, climate RE-exposure, portfolio optimization — is
// computed against a fabricated $445M book and shown to an examiner as real
// (e.g. chat-analyst renders "LCR: 115%. Status: Compliant" for an institution
// with zero loaded assets). The total-assets figure is the DENOMINATOR of the
// whole ALM stack; fabricating it poisons everything above it.
//
// WHY A SEPARATE GATE (not verify:d1-no-silent-fallback): the D1 gate matches
// `getDemo*()` / `getMock*()` FUNCTION names. This phantom is an INLINE literal
// fallback (`|| 445`) with no function to name, so the D1 gate is blind to it.
// `ncua-rbc2.service.ts` already killed its own `|| 445` / `* 0.87` phantoms —
// its code comment proves this is a recognized D1 anti-pattern. This gate locks
// the pattern across the rest of src/alm. The honest fix is the canonical D1
// shell: empty balance sheet → status:'data_unavailable' + a CRITICAL
// EMPTY_BALANCE_SHEET DataGap, numeric totals `null` — never a magic number.
//
// THE ANTI-PATTERN (comments stripped FIRST, so ncua-rbc2's note about the
// phantom it REMOVED does not count): a balance aggregation `… balance, 0 )`
// immediately defaulted with `||` / `??` to a 2+-digit number. Tight on purpose
// — a real `… balance, 0)` followed by `|| 445` is unambiguously the phantom;
// benign `?? 0` / `|| 1` guards and non-balance defaults are not matched.
//
// Count-based (mirrors verify-no-silent-catch / verify-no-unseeded-random): a
// file fails if its phantom count EXCEEDS baseline or it is a NEW file with any
// phantom. Drive a file to 0 (apply the D1 shell) and remove its baseline entry;
// the stale detector fails CI if you forget.
//
// Exit codes:
//   0 — every src/alm file is clean or at/under baseline; no stale entries
//   1 — a new/grown phantom appeared, or a baseline entry is stale
//
// Skip the script entirely with VERIFY_NO_PHANTOM_BALANCE_TOTAL_SKIP=1.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const SCOPE_PREFIX = 'alm/';
const ALM_ROOT = join(SRC_ROOT, 'alm');

// A balance aggregation `… balance, 0)` immediately defaulted with `||`/`??` to
// a 2+-digit magic number. Does NOT match a benign `|| 0` / `|| 1`, and the
// `balance, 0)` anchor keeps it off unrelated `|| <num>` defaults.
const PHANTOM_TOTAL = /\bbalance\s*,\s*0\s*\)\s*(\|\||\?\?)\s*\d{2,}/g;

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

export function countPhantoms(content) {
  const code = stripComments(content);
  return (code.match(PHANTOM_TOTAL) || []).length;
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// relPath (from src/) → known phantom-balance-total count. Drive a count to 0
// by applying the D1 shell (empty → data_unavailable + EMPTY_BALANCE_SHEET gap,
// null totals) and remove the entry. The stale detector fails CI if you forget.
//
// Locked 2026-06-08 at 5 entries / 7 phantoms; CLEARED 2026-06-09: the swarm's
// D1-shell sweep removed every `|| 445`/`|| 385` phantom from all 5 files
// (stress-v2, camel-scorer, chat-analyst, climate-risk, robust-optimizer →
// empty balance sheet now returns status:'data_unavailable' + a CRITICAL gap),
// so the stale-detector demanded the credit be taken. 0 phantoms remain → the
// gate is now a ZERO-TOLERANCE lock on the `reduce(...balance,0) || <num>`
// fabrication. ncua-rbc2 was never here (removed its own `|| 445` earlier).
const BASELINE = {};

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
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ─── Classifier ──────────────────────────────────────────────────────────
//   { status: 'none' }                              — out of scope / 0 phantoms
//   { status: 'baselined', count, baseline }        — at/under baseline
//   { status: 'violation', count, baseline, reason }— new file OR grew past baseline
export function classify(content, relPath) {
  if (!relPath.startsWith(SCOPE_PREFIX)) return { status: 'none' };
  const total = countPhantoms(content);
  if (total === 0) return { status: 'none' };

  if (relPath in BASELINE) {
    const baseline = BASELINE[relPath];
    if (total > baseline) {
      return {
        status: 'violation',
        count: total,
        baseline,
        reason: 'grew past baseline',
      };
    }
    return { status: 'baselined', count: total, baseline };
  }
  return { status: 'violation', count: total, baseline: 0, reason: 'new file' };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_NO_PHANTOM_BALANCE_TOTAL_SKIP === '1') {
    console.log(
      'verify-no-phantom-balance-total: skipped (VERIFY_NO_PHANTOM_BALANCE_TOTAL_SKIP=1)',
    );
    process.exit(0);
  }
  if (!existsSync(ALM_ROOT)) {
    console.error(
      `verify-no-phantom-balance-total: src/alm not found at ${ALM_ROOT}`,
    );
    process.exit(1);
  }

  const files = walkTs(ALM_ROOT);
  let baselined = 0;
  let baselinedPhantoms = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;
    if (result.status === 'baselined') {
      baselined++;
      baselinedPhantoms += result.count;
      baselineHits.add(rel);
    } else {
      if (rel in BASELINE) baselineHits.add(rel);
      violations.push({ rel, ...result });
    }
  }

  const stale = Object.keys(BASELINE).filter((k) => !baselineHits.has(k));

  console.log(
    `verify-no-phantom-balance-total: scanned ${files.length} src/alm files`,
  );
  console.log(
    `  ${baselined} baselined file(s) / ${baselinedPhantoms} known phantom(s) · ${violations.length} violation(s)`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n✓→ Stale baseline entries (phantom now 0 — remove + take the chip-away credit):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log('\n❌ Phantom balance-sheet total(s) in src/alm (BLOCKING):');
    for (const v of violations) {
      console.log(
        `  - ${v.rel}  [${v.count} phantom(s), baseline ${v.baseline} — ${v.reason}]`,
      );
    }
    console.log(
      '\n  Fix: a balance-sheet total must NEVER `|| <magic number>`.',
    );
    console.log('       On an empty balance sheet return the D1 shell —');
    console.log(
      "       status:'data_unavailable' + a CRITICAL EMPTY_BALANCE_SHEET",
    );
    console.log(
      '       DataGap with null totals — never a fabricated $445M book.',
    );
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    `\n✓ no-phantom-balance-total: no new phantoms. ${baselined} file(s) / ${baselinedPhantoms} phantom(s) remain on the chip-away ledger.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: '`balance, 0) || 445` in alm → violation (new file)',
      content: `const t = items.reduce((s, i) => s + i.balance, 0) || 445;`,
      rel: 'alm/new.service.ts',
      expected: 'violation',
    },
    {
      name: '`balance, 0) || 385` (3-digit) → violation',
      content: `const l = liabs.reduce((s, i) => s + i.balance, 0) || 385;`,
      rel: 'alm/new2.service.ts',
      expected: 'violation',
    },
    {
      name: '`balance, 0 ) ?? 500` (nullish + whitespace) → violation',
      content: `const t = items.reduce((s, i) => s + i.balance, 0 ) ?? 500;`,
      rel: 'alm/new3.service.ts',
      expected: 'violation',
    },
    {
      name: 'two phantoms in one file → violation (count 2)',
      content: `const a = x.reduce((s,i)=>s+i.balance, 0) || 445;\nconst b = y.reduce((s,i)=>s+i.balance, 0) || 385;`,
      rel: 'alm/two.service.ts',
      expected: 'violation',
    },
    {
      name: 'honest D1 shell (no `|| <num>`) → none',
      content: `if (items.length === 0) return this.dataUnavailableResult();\nconst t = items.reduce((s, i) => s + i.balance, 0);`,
      rel: 'alm/honest.service.ts',
      expected: 'none',
    },
    {
      name: 'benign `|| 0` guard → none (not 2+ digits)',
      content: `const t = items.reduce((s, i) => s + i.balance, 0) || 0;`,
      rel: 'alm/guard.service.ts',
      expected: 'none',
    },
    {
      name: 'unrelated `|| 50` default (not a balance,0) aggregation) → none',
      content: `const limit = params.limit || 50;`,
      rel: 'alm/limit.service.ts',
      expected: 'none',
    },
    {
      name: 'clean file → none',
      content: `export function add(a, b) { return a + b; }`,
      rel: 'alm/clean.service.ts',
      expected: 'none',
    },
    {
      name: 'comment mentioning `balance, 0) || 445` → none (stripped)',
      content: `// removed the old reduce(...balance, 0) || 445 phantom\nexport const x = 1;`,
      rel: 'alm/comment.service.ts',
      expected: 'none',
    },
    {
      name: 'phantom outside src/alm → none (out of scope)',
      content: `const t = items.reduce((s, i) => s + i.balance, 0) || 445;`,
      rel: 'risk/var.service.ts',
      expected: 'none',
    },
    {
      name: 'baselined file AT its count → baselined',
      content: `const t = items.reduce((s, i) => s + i.balance, 0) || 445;`, // count 1, baseline 1
      rel: 'alm/__selftest__.service.ts',
      expected: 'baselined',
    },
    {
      name: 'baselined file GROWN past its count → violation',
      content: `const a = x.reduce((s,i)=>s+i.balance, 0) || 445;\nconst b = y.reduce((s,i)=>s+i.balance, 0) || 385;`, // count 2 > baseline 1
      rel: 'alm/__selftest__.service.ts',
      expected: 'violation',
    },
  ];

  // The real BASELINE is empty (the class was fully chipped), so inject a temp
  // ceiling for the two "baselined" cases, then remove it before the parity check.
  BASELINE['alm/__selftest__.service.ts'] = 1;

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const result = classify(c.content, c.rel);
    if (result.status === c.expected) pass++;
    else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${result.status}`);
    }
  }
  delete BASELINE['alm/__selftest__.service.ts'];

  // Parity: baseline keys are in scope and have positive counts.
  const bad = Object.entries(BASELINE).filter(
    ([k, v]) => !k.startsWith(SCOPE_PREFIX) || !(v > 0),
  );
  if (bad.length === 0) pass++;
  else {
    fail++;
    console.log(
      `✗ baseline has out-of-scope or non-positive entries: ${bad.map(([k]) => k).join(', ')}`,
    );
  }

  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
