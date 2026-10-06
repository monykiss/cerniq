#!/usr/bin/env node
// scripts/verify-d1-no-silent-fallback.mjs
//
// Enforces CerniQ Decision D1 ("never silent zeros") at the one place it
// has, until now, been enforced only by manual review + a single keystone
// test (src/alm/report-accuracy.spec.ts).
//
// THE POLICY (SESSION_HANDOFF §1 D1, dead 2026-04-07):
//   An ALM report producer that receives empty / insufficient input MUST
//   surface that honestly — `status: 'data_unavailable'` + a `gaps[]`
//   explanation, numeric fields `null`. It must NEVER fabricate a
//   plausible-looking result. A cooperativa that has uploaded no data must
//   read "no data," never a false CUMPLE / a healthy-looking curve.
//
// THE ANTI-PATTERN THIS GATE CATCHES:
//   Across src/alm the fabrication helpers follow one naming convention:
//   `getDemo*()` (getDemoResult, getDemoDecay, getDemoSegments, …). The D1
//   sweep (batches 1–3, 2026-06) fixed ~11 services by DELETING the helper
//   and replacing it with an honest empty-data shell — leaving behind only
//   a `// D1 honest shell. Replaces the former getDemoResult()…` tombstone
//   COMMENT. So the discriminator between "fixed" and "still fabricating"
//   is: does `getDemo*` survive comment-stripping?  If it appears in CODE,
//   the service still has a live fabrication path.
//
//   This gate strips comments, then flags any src/alm file that still
//   references a `getDemo*` identifier in code and is not on the baseline.
//   New fabrication paths are blocked at CI; the chip-away ledger is now at
//   ZERO (every src/alm service has been swept), so the gate is a pure
//   non-regression lock + the 2 ALLOW labeled-demo routes.
//
// HONEST SCOPE (this gate is not magic — D1 demands we say so):
//   • It catches the established `getDemo*` naming anti-pattern in src/alm.
//   • It does NOT catch arbitrary inline fabrication (e.g. a bare
//     `return { healthScore: 75 }` on empty input that is not named
//     getDemo*). report-accuracy.spec.ts remains the behavioural backstop
//     for the entry-point services. This gate is the *non-regression* lock
//     on the naming convention + a visible chip-away ledger.
//
// Exit codes:
//   0 — every src/alm file is clean or baselined; no stale baseline entries
//   1 — a new (unbaselined) getDemo* path appeared, or a baseline entry is
//       stale (the file no longer has getDemo* — remove it and take credit)
//
// Skip the script entirely with VERIFY_D1_SKIP=1 (emergency escape).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const ALM_ROOT = join(SRC_ROOT, 'alm');

// ─── Pattern ───────────────────────────────────────────────────────────
// Matches a `getDemo<Suffix>` identifier (callsite or declaration) in code.
// Comments are stripped before this runs, so a D1-tombstone comment that
// merely names the former helper does NOT match.
const FABRICATION_IDENT = /\bgetDemo[A-Za-z0-9_]*\b/g;

// Only ALM report producers are in D1 scope.
const SCOPE_PREFIX = 'alm/';

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// Two kinds of entries:
//   TODO  — a service that still fabricates on empty input. The D1 fix is
//           to delete getDemo* and return an honest data_unavailable shell
//           (see concentration.service.ts / black-litterman.service.ts for
//           the canonical "D1 honest shell" pattern). When fixed, REMOVE
//           the entry — the stale-baseline detector will confirm it's gone.
//   ALLOW — a deliberately-named, honestly-labeled demo endpoint. Not a
//           silent fallback; permanent. Documented so review knows it's OK.
//
// Locked 2026-06-08: 0 TODO + 2 ALLOW = 2 files. 0 unbaselined violations.
// 🎉 The D1 chip-away ledger is at ZERO — every src/alm report producer now
// returns an honest data_unavailable shell on empty/insufficient input. The
// gate is now a pure non-regression lock + the 2 ALLOW (labeled-demo) routes.
const BASELINE = {
  // ── ALLOW: honest, explicitly-labeled demo endpoints (permanent) ──
  'alm/alm.service.ts':
    'ALLOW — getDemoBalanceSheet() backs the explicit @Get("demo-balance-sheet") fixture route; honestly labeled demo, not an empty-input fallback.',
  'alm/alm.controller.ts':
    'ALLOW — @Get("demo-balance-sheet") / @Get("demo-analysis") are explicit demo routes that never masquerade as a real institution.',

  // ── TODO: (empty) — the D1 chip-away ledger is at ZERO. Every src/alm
  //    service now returns an honest data_unavailable shell on empty/insufficient
  //    input (deposit-decay, repricing-gap, the 4 loan-segment-credit services,
  //    the 5 balance-sheet readers, sofr-monitor, nim-attribution,
  //    network-intelligence, hmm-regime, pca-yield-curve). The hmm/pca
  //    controller endpoints that fed SYNTHETIC input were de-fabricated too.
};

// ─── Walker ──────────────────────────────────────────────────────────────
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

// ─── Classifier ────────────────────────────────────────────────────────
//   { status: 'none' }                  — out of scope, or no getDemo* in code
//   { status: 'baselined', reason, kind, hits } — known offender / allow
//   { status: 'violation', hits }       — NEW fabrication path (BLOCKING)
export function classify(content, relPath) {
  if (!relPath.startsWith(SCOPE_PREFIX)) return { status: 'none' };

  const code = stripComments(content);
  const matches = code.match(FABRICATION_IDENT);
  if (!matches) return { status: 'none' };

  const hits = [...new Set(matches)];

  if (relPath in BASELINE) {
    const reason = BASELINE[relPath];
    const kind = reason.startsWith('ALLOW') ? 'allow' : 'todo';
    return { status: 'baselined', reason, kind, hits };
  }
  return { status: 'violation', hits };
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_D1_SKIP === '1') {
    console.log('verify-d1-no-silent-fallback: skipped (VERIFY_D1_SKIP=1)');
    process.exit(0);
  }

  if (!existsSync(ALM_ROOT)) {
    console.error(
      `verify-d1-no-silent-fallback: src/alm not found at ${ALM_ROOT}`,
    );
    process.exit(1);
  }

  const files = walkTs(ALM_ROOT);
  let todo = 0;
  let allow = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;

    if (result.status === 'baselined') {
      baselineHits.add(rel);
      if (result.kind === 'allow') allow++;
      else todo++;
    } else if (result.status === 'violation') {
      violations.push({ rel, hits: result.hits });
    }
  }

  const stale = Object.keys(BASELINE).filter((k) => !baselineHits.has(k));

  console.log(
    `verify-d1-no-silent-fallback: scanned ${files.length} src/alm files`,
  );
  console.log(
    `  ${todo} TODO (still fabricating) · ${allow} ALLOW (labeled demo) · ${violations.length} new violations`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n✓→ Stale baseline entries (getDemo* gone — remove + take the chip-away credit):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log(
      '\n❌ New D1 fabrication path(s) — a getDemo* fallback in src/alm (BLOCKING):',
    );
    for (const v of violations) {
      console.log(`  - ${v.rel}  [${v.hits.join(', ')}]`);
    }
    console.log(
      '\n  D1 fix: on empty/insufficient input, return an honest shell —',
    );
    console.log(
      "       { status: 'data_unavailable', gaps: [...], <numeric>: null } —",
    );
    console.log(
      '       see src/alm/concentration.service.ts for the canonical pattern.',
    );
    console.log(
      '       Do NOT add a getDemo* helper. If this is a deliberate, labeled',
    );
    console.log(
      '       demo endpoint, add an ALLOW entry to BASELINE in this script.',
    );
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    `\n✓ D1 (never silent zeros): no new fabrication paths. ${todo} service(s) remain on the chip-away ledger.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'alm file with live getDemoResult() callsite → violation',
      content: `if (n === 0) return this.getDemoResult(alpha);`,
      rel: 'alm/brand-new.service.ts',
      expected: 'violation',
    },
    {
      name: 'alm file with getDemo* only in a // tombstone comment → none',
      content: `export class X {}\n// D1 honest shell. Replaces the former getDemoResult() that fabricated.`,
      rel: 'alm/fixed.service.ts',
      expected: 'none',
    },
    {
      name: 'alm file with getDemo* only in a /* */ block comment → none',
      content: `/* historical: getDemoSegments() removed in batch 2 */\nexport const x = 1;`,
      rel: 'alm/fixed-block.service.ts',
      expected: 'none',
    },
    {
      name: 'alm file with no getDemo at all → none',
      content: `return { status: 'data_unavailable', gaps: ['no balance sheet'], value: null };`,
      rel: 'alm/honest.service.ts',
      expected: 'none',
    },
    {
      name: 'getDemo* in a now-fixed (non-baselined) alm service → violation (ledger at zero)',
      content: `if (n === 0) return this.getDemoResult(alpha);`,
      rel: 'alm/sofr-monitor.service.ts',
      expected: 'violation',
    },
    {
      name: 'baselined ALLOW demo endpoint → baselined',
      content: `getDemoBalanceSheet() { return {...}; }`,
      rel: 'alm/alm.service.ts',
      expected: 'baselined',
    },
    {
      name: 'non-alm file with getDemo* in code → none (out of scope)',
      content: `return getDemoResult();`,
      rel: 'scripts-mirror/provision.ts',
      expected: 'none',
    },
    {
      name: 'getDemo* method declaration in a new alm file → violation',
      content: `private getDemoResult(): Foo { return { fake: 1 }; }`,
      rel: 'alm/another-new.service.ts',
      expected: 'violation',
    },
    {
      name: 'getDemo as a substring of a longer identifier → still flagged (convention is strict)',
      content: `return this.getDemoizedResult();`,
      rel: 'alm/edge.service.ts',
      expected: 'violation',
    },
    {
      name: 'comment-stripping does not eat a following code line',
      content: `// getDemoResult historical note\nreturn this.getDemoResult();`,
      rel: 'alm/mixed.service.ts',
      expected: 'violation',
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

  // Parity check: the baseline must contain only in-scope keys.
  const outOfScope = Object.keys(BASELINE).filter(
    (k) => !k.startsWith(SCOPE_PREFIX),
  );
  if (outOfScope.length === 0) {
    pass++;
  } else {
    fail++;
    console.log(
      `✗ baseline contains out-of-scope keys: ${outOfScope.join(', ')}`,
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
