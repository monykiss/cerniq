#!/usr/bin/env node
// scripts/verify-decimal-coercion.mjs
//
// Locks a VERIFIED, TEST-HIDDEN bug class: a Prisma `Decimal` column used as a
// raw JS number without coercion. Prisma maps `Decimal` to a `Prisma.Decimal`
// (decimal.js) OBJECT, and JS treats that object two dangerous ways:
//
//   1. STRING-CONCAT — `valueOf()` on a Decimal returns a STRING, so binary `+`
//      concatenates instead of adding:
//        const total = items.reduce((s, i) => s + i.balance, 0);  // ← BUG
//        // [100, 200, 300]  →  "0100200300"  (a string), NOT 600
//      The `+` operator is the ONLY arithmetic operator that does this; `*`,
//      `/`, `%`, `-` all force ToNumber. So `s + i.balance * i.rate` is SAFE
//      (the higher-precedence `*` coerces first) but `s + i.balance` is BROKEN.
//      The concatenated "total" then poisons every downstream ratio (NIM uses
//      it as a denominator, LCR/CECL/DFAST as a base) — and is rendered to an
//      examiner as a real number.
//
//   2. ISFINITE-ZEROING — a Decimal object is never a finite number primitive,
//      so `Number.isFinite(i.balance)` is ALWAYS false (and `Number.isNaN(...)`
//      always false). A guard like `Number.isFinite(i.balance) ? i.balance : 0`
//      SILENTLY ZEROS every real balance in production (e.g. cecl.service.ts's
//      validateSegment zeroed balance / historicalLossRate → a $0 CECL
//      allowance filed for an institution with real loans).
//
// WHY THE SUITE NEVER CAUGHT IT: the specs mock these fields as plain JS
// `number`s, so `s + 100` adds and `Number.isFinite(100)` is true in tests
// while `s + Decimal(100)` concatenates and `Number.isFinite(Decimal)` is false
// in prod. Green unit suite, broken production. portfolio-var (06f5d2b) and
// monte-carlo fixed two services; this gate locks the WHOLE class.
//
// THE FIX (universally safe — `Number(5) === 5`, so coercing a value that is
// already a number is a no-op, and coercing a Decimal corrects it):
//   const total = items.reduce((s, i) => s + Number(i.balance), 0);
//   const bal = Number(i.balance); return Number.isFinite(bal) ? bal : 0;
// A `this.num(i.balance)` helper (monte-carlo) is equally accepted.
//
// DETECTION (comments stripped FIRST so a tombstone note about a removed bug is
// not counted). Anchored so already-fixed sites are auto-excluded:
//   • concat: `+`/`+=` directly followed by `<ident>.<DecimalField>` that is
//     NOT followed by a higher-precedence coercer (`* / % .`). `+ Number(i.balance)`
//     and `+ this.num(i.balance)` do NOT match (the field is inside the call,
//     not bare after `+`); `+ i.balance * i.rate` does NOT match (lookahead).
//   • guard: `isFinite(`/`isNaN(` (optionally `Number.`-qualified) directly
//     wrapping `<ident>.<DecimalField>`. `Number.isFinite(Number(i.balance))`
//     and `Number.isFinite(bal)` (a pre-coerced local) do NOT match.
//   The field set is the Prisma `Decimal` COLUMN names from prisma/schema.prisma
//   (so computed result fields like `expectedLoss`/`economicCapital` — never
//   Decimals — are not flagged).
//
// SWARM-FRIENDLY LEDGER (a deliberate deviation from verify-no-phantom-balance-
// total's stale-fail): this bug class is being chipped service-by-service by
// several concurrent sessions. A stale-fail-on-zero gate would force every peer
// who zeroes a file to ALSO edit this baseline in the same commit — turning the
// baseline into a hot shared-tree file and a stage-race generator. So instead
// the baseline is a per-file CEILING: a file passes at-or-UNDER its baseline
// (including 0), and only a NEW offending file or a count that GROWS past its
// ceiling fails. Peer fixes ratchet counts down with ZERO baseline edits. When
// the class is fully chipped, a final pass tightens every ceiling to 0 and the
// gate becomes a hard zero-tolerance lock. Trade-off (documented honestly per
// D1): while a file sits above 0 in the baseline, re-introducing a bug BELOW its
// ceiling is not caught until the final tighten — acceptable mid-sweep.
//
// Exit codes:
//   0 — no new offender file and no file grown past its ceiling
//   1 — a new offending file, or a baselined file grew past its ceiling
//
// Skip the script entirely with VERIFY_DECIMAL_COERCION_SKIP=1.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

// ─── Prisma Decimal column names (from prisma/schema.prisma) ──────────────
// Fields SUMMED in practice (the string-concat surface).
const CONCAT_FIELDS = [
  'balance',
  'amount',
  'currentBalance',
  'originalBalance',
  'defaults',
  'baseAllowance',
  'adverseAllowance',
  'severeAllowance',
  'hqlaLevel1',
  'hqlaLevel2',
  'cashOutflows',
  'cashInflows',
  'niImpact',
  'mveImpact',
  'totalAssets',
  'totalLiabilities',
  'glBalance',
  'totalDebit',
  'totalCredit',
  'materialityAbs',
  'revenueAmount',
];
// Any Decimal field inside isFinite/isNaN is a bug — use the broad column set.
const GUARD_FIELDS = [
  ...CONCAT_FIELDS,
  'rate',
  'duration',
  'lcr',
  'nsfr',
  'weightedAvgRate',
  'weightedAvgMaturity',
  'historicalLossRate',
  'lgd',
  'qualitativeAdj',
  'insuredPct',
  'flightRate',
  'avgRate',
  'maxPct',
  'currentPct',
  'watchPct',
  'warningPct',
  'breachPct',
  'actualValue',
  'limitValue',
  'camelComposite',
  'nimSnapshot',
  'lcrSnapshot',
  'marketCap',
  'quantity',
  'avgCost',
  'depositBeta',
];

// `+`/`+=` then `<ident>.<DecimalField>` NOT followed by a higher-precedence
// coercer (`* / %`) or a method/`.` (e.g. `.toNumber()`).
const CONCAT_RE = new RegExp(
  `[+]=?\\s*[A-Za-z_$][\\w$]*\\.(?:${CONCAT_FIELDS.join('|')})\\b(?!\\s*[*/%.])`,
  'g',
);
// `isFinite(`/`isNaN(` wrapping a bare `<ident>.<DecimalField>`.
const GUARD_RE = new RegExp(
  `(?:Number\\.)?(?:isFinite|isNaN)\\(\\s*[A-Za-z_$][\\w$]*\\.(?:${GUARD_FIELDS.join('|')})\\b`,
  'g',
);

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

export function countOffenders(content) {
  const code = stripComments(content);
  const concat = (code.match(CONCAT_RE) || []).length;
  const guard = (code.match(GUARD_RE) || []).length;
  return { concat, guard, total: concat + guard };
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// relPath (from src/) → per-file ceiling (string-concat + isFinite-zeroing
// offender count) at lock time. A file passes at-or-UNDER its ceiling (drive it
// to 0 by Number()-coercing the Decimal at the `+`/isFinite site). Peer fixes
// ratchet counts down WITHOUT editing this map (no stale-fail). When the class
// is fully chipped, tighten every ceiling to 0.
//
// Locked 2026-06-08 at 49 files / 142 offenders (swarm-friendly ceiling). The
// coercion SWEEP (this session's codemod + portfolio-var 06f5d2b + monte-carlo
// 3cae65e) then drove the WHOLE tree to 0, so the ceiling was tightened to
// empty: this gate is now a ZERO-TOLERANCE lock — ANY new `+ <Decimal>`
// string-concat or `isFinite(<Decimal>)` zeroing fails CI. To re-open the
// ledger mid-sweep, restore per-file ceilings from this file's git history.
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
//   { status: 'none' }                              — 0 offenders
//   { status: 'baselined', count, baseline }        — at/under ceiling
//   { status: 'violation', count, baseline, reason }— new file OR grew past ceiling
export function classify(content, relPath) {
  const { total } = countOffenders(content);
  if (total === 0) return { status: 'none' };

  if (relPath in BASELINE) {
    const baseline = BASELINE[relPath];
    if (total > baseline) {
      return {
        status: 'violation',
        count: total,
        baseline,
        reason: 'grew past ceiling',
      };
    }
    return { status: 'baselined', count: total, baseline };
  }
  return { status: 'violation', count: total, baseline: 0, reason: 'new file' };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_DECIMAL_COERCION_SKIP === '1') {
    console.log(
      'verify-decimal-coercion: skipped (VERIFY_DECIMAL_COERCION_SKIP=1)',
    );
    process.exit(0);
  }
  if (!existsSync(SRC_ROOT)) {
    console.error(`verify-decimal-coercion: src not found at ${SRC_ROOT}`);
    process.exit(1);
  }

  const files = walkTs(SRC_ROOT);
  let baselined = 0;
  let baselinedOffenders = 0;
  let fixedBelow = 0; // baselined files that ratcheted UNDER their ceiling (still >0)
  const violations = [];
  const offending = new Set(); // baseline files that still carry >0 offenders

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue; // a baselined file at 0 falls through → cleared
    if (rel in BASELINE) offending.add(rel);
    if (result.status === 'baselined') {
      baselined++;
      baselinedOffenders += result.count;
      if (result.count < result.baseline) fixedBelow++;
    } else {
      violations.push({ rel, ...result });
    }
  }

  // Baseline files whose count is now 0 (fully chipped — fixed on disk or
  // deleted). Advisory only, NOT a failure (swarm-friendly: peers don't edit
  // this baseline; a final pass tightens these ceilings to 0).
  const cleared = Object.keys(BASELINE).filter((k) => !offending.has(k));

  console.log(`verify-decimal-coercion: scanned ${files.length} src file(s)`);
  console.log(
    `  ${baselined} baselined / ${baselinedOffenders} known offender(s) · ${fixedBelow} ratcheted-down · ${cleared.length} cleared · ${violations.length} violation(s)`,
  );

  if (cleared.length > 0) {
    console.log(
      '\n✓→ Cleared (count now 0 — tighten its ceiling to 0 when the class is closed):',
    );
    for (const k of cleared) console.log(`  - ${k}`);
  }

  if (violations.length > 0) {
    console.log('\n❌ Prisma Decimal used as a raw number (BLOCKING):');
    for (const v of violations) {
      console.log(
        `  - ${v.rel}  [${v.count} offender(s), ceiling ${v.baseline} — ${v.reason}]`,
      );
    }
    console.log(
      '\n  Fix: coerce the Decimal with Number(...) (or this.num(...)) at the',
    );
    console.log(
      '       `+`/`isFinite` site — e.g. `s + Number(i.balance)`. `*`/`/` are',
    );
    console.log(
      '       already safe; only bare `+` concatenates and isFinite/isNaN zero.',
    );
    process.exit(1);
  }

  console.log(
    `\n✓ decimal-coercion: no new Decimal-as-number offenders. ${baselined} file(s) / ${baselinedOffenders} on the chip-away ledger.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'reduce `s + i.balance` → violation (new file)',
      content: `const t = items.reduce((s, i) => s + i.balance, 0);`,
      rel: 'alm/new.service.ts',
      expected: 'violation',
    },
    {
      name: '`entry.balance += item.balance` → violation',
      content: `entry.balance += item.balance;`,
      rel: 'alm/accum.service.ts',
      expected: 'violation',
    },
    {
      name: '`s + e.amount` over expense rows → violation',
      content: `const total = expenses.reduce((s, e) => s + e.amount, 0);`,
      rel: 'expenses/x.service.ts',
      expected: 'violation',
    },
    {
      name: 'Number.isFinite(seg.balance) guard → violation',
      content: `const b = Number.isFinite(seg.balance) ? seg.balance : 0;`,
      rel: 'alm/guard-new.service.ts',
      expected: 'violation',
    },
    {
      name: 'SAFE: `s + i.balance * i.rate` (× coerces first) → none',
      content: `const nii = items.reduce((s, i) => s + i.balance * i.rate, 0);`,
      rel: 'alm/safe1.service.ts',
      expected: 'none',
    },
    {
      name: 'FIXED: `s + Number(i.balance)` → none',
      content: `const t = items.reduce((s, i) => s + Number(i.balance), 0);`,
      rel: 'alm/fixed1.service.ts',
      expected: 'none',
    },
    {
      name: 'FIXED: `s + this.num(i.balance)` → none',
      content: `const t = items.reduce((s, i) => s + this.num(i.balance), 0);`,
      rel: 'alm/fixed2.service.ts',
      expected: 'none',
    },
    {
      name: 'FIXED: isFinite over a pre-coerced local → none',
      content: `const bal = Number(item.balance); return s + (Number.isFinite(bal) ? bal : 0);`,
      rel: 'alm/fixed3.service.ts',
      expected: 'none',
    },
    {
      name: 'FIXED: isFinite(Number(seg.balance)) → none',
      content: `const x = Number.isFinite(Number(seg.balance)) ? seg.balance : 0;`,
      rel: 'alm/fixed4.service.ts',
      expected: 'none',
    },
    {
      name: 'SAFE: `i.balance.toNumber()` method call → none',
      content: `const t = base + i.balance.toNumber();`,
      rel: 'alm/safe2.service.ts',
      expected: 'none',
    },
    {
      name: 'comment mentioning `s + i.balance` → none (stripped)',
      content: `// old bug: items.reduce((s,i)=>s+i.balance,0)\nexport const x = 1;`,
      rel: 'alm/comment.service.ts',
      expected: 'none',
    },
    {
      name: 'non-Decimal computed field `s + seg.expectedLoss` → none (not a column)',
      content: `const t = segments.reduce((s, seg) => s + seg.expectedLoss, 0);`,
      rel: 'alm/computed.service.ts',
      expected: 'none',
    },
    {
      name: 'clean file → none',
      content: `export function add(a, b) { return a + b; }`,
      rel: 'alm/clean.service.ts',
      expected: 'none',
    },
    {
      name: 'baselined file AT its ceiling → baselined',
      content: `const t = items.reduce((s, i) => s + i.balance, 0);`, // count 1
      rel: '__selftest_baselined__.service.ts',
      expected: 'baselined',
    },
    {
      name: 'baselined file GROWN past its ceiling → violation',
      content: `const a = x.reduce((s,i)=>s+i.balance,0);\nconst b = y.reduce((s,i)=>s+i.balance,0);`, // count 2 > ceiling 1
      rel: '__selftest_baselined__.service.ts',
      expected: 'violation',
    },
    {
      name: 'baselined file UNDER its ceiling (peer fixed) → none, not a fail',
      content: `const t = items.reduce((s, i) => s + Number(i.balance), 0);`, // count 0 ≤ ceiling 1
      rel: '__selftest_baselined__.service.ts',
      expected: 'none',
    },
  ];

  // Inject a self-test ceiling without polluting the real BASELINE.
  BASELINE['__selftest_baselined__.service.ts'] = 1;

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
  delete BASELINE['__selftest_baselined__.service.ts'];

  // Parity: every real baseline entry has a positive ceiling.
  const bad = Object.entries(BASELINE).filter(([, v]) => !(v > 0));
  if (bad.length === 0) pass++;
  else {
    fail++;
    console.log(
      `✗ baseline has non-positive ceiling(s): ${bad.map(([k]) => k).join(', ')}`,
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
