#!/usr/bin/env node
// scripts/verify-no-silent-catch.mjs
//
// Enforces the (until now unwritten) CerniQ rule that an ALM report
// producer must NEVER silently swallow an error. A swallowed error in
// src/alm is a D1-adjacent failure: the report renders a phantom zero / an
// empty section / a stale fallback, and neither the user nor the audit log
// learns that a data source actually FAILED (vs. was legitimately empty).
//
// The canonical harm this gate exists to stop:
//   • excel-export.service.ts — 4× `.catch(() => null)` across the ALM
//     summary / COSSEC / balance-sheet / NII fetches: any one failing
//     renders phantom blanks in the examiner workbook with no error stamp.
//   • data-privacy.service.ts — `.catch(() => [])` on an expense query:
//     a GDPR/SAR export looks complete while silently missing rows.
//   • cecl-vintage.service.ts — `catch { /* non-critical */ }` around the
//     CECL allowance audit-log write: the allowance was computed but its
//     audit record could silently vanish — a Rule 4 (append-only audit)
//     chain hole. CLOSED 2026-06-07: the catch now logs
//     `cecl_vintage.allowance_persist_failed` (best-effort, non-throwing).
//
// THE TWO HIGH-CONFIDENCE ANTI-PATTERNS THIS GATE CATCHES (comments
// stripped first, so a comment that merely mentions one does not count):
//   P1  swallowing arrow-catch:  `.catch(() => <empty/fallback literal>)`
//       where the arrow body starts with [] / null / undefined / {} / ({ —
//       i.e. substitutes a value instead of logging / rethrowing.
//   P2  empty (or comment-only) catch block:  `catch (e?) { }`
//
// HONEST SCOPE (we say what we do NOT catch — silence about gaps is the
// very thing this gate punishes):
//   • It does NOT catch a block-body that assigns a fallback without
//     logging (`catch { x = []; }`) — that needs AST analysis. A swallow
//     written that way is still a bug; this gate just doesn't see it.
//   • It does NOT catch `.catch(() => someVar)` or block-body arrows.
//   • Scope is src/alm only (highest report-integrity stakes); widen via
//     SCOPE_PREFIX when the convention proves out.
//   The behavioural backstop remains code review + report-accuracy.spec.ts.
//   This gate is the NON-REGRESSION lock + a count-based chip-away ledger.
//
// Count-based (mirrors verify-rule-11): a file fails if its swallow count
// EXCEEDS its baseline (within-file regression) or it is a NEW file with
// any swallow. Fixing a file below baseline is always allowed; driving it
// to 0 makes its baseline entry stale (remove it, take the credit).
//
// Exit codes:
//   0 — every src/alm file is clean or at/under baseline; no stale entries
//   1 — a new/grown swallow appeared, or a baseline entry is stale
//
// Skip the script entirely with VERIFY_NO_SILENT_CATCH_SKIP=1.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const SCOPE_PREFIX = 'alm/';
const ALM_ROOT = join(SRC_ROOT, 'alm');

// ─── Patterns ──────────────────────────────────────────────────────────
// P1: `.catch(` + an arrow `(...) =>` whose body STARTS with a swallow
//     literal. Tight on purpose — near-zero false positives.
const P1_ARROW_SWALLOW =
  /\.catch\(\s*\(\s*[^)]*\)\s*=>\s*(\[\s*\]|null\b|undefined\b|\{\s*\}|\(\s*\{)/g;
// P2: an empty (comments already stripped → comment-only counts as empty)
//     catch block.
const P2_EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

export function countSwallows(content) {
  const code = stripComments(content);
  const p1 = (code.match(P1_ARROW_SWALLOW) || []).length;
  const p2 = (code.match(P2_EMPTY_CATCH) || []).length;
  return { total: p1 + p2, p1, p2 };
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// relPath (from src/) → known swallow count. Drive a count to 0 and remove
// the entry; the stale detector fails CI if you forget. Each entry names
// the remediation: replace the swallow with a logged + tagged failure
// (logger.warn/error + the gap surfaced to the caller), or rethrow.
//
// Locked 2026-06-08: 5 entries / 5 swallows. 0 unbaselined.
// (excel-export.service.ts cleared 2026-06-07: all 4 fetch `.catch`es now log
//  + push a CRITICAL DEPENDENCY_REJECTED DataGap into the Data Gaps sheet.
//  nim-attribution.service.ts cleared 2026-06-08: the `.catch(() => ({demo}))`
//  swallow WAS the getDemoResult() body — deleting it for the D1 sweep removed
//  the swallow, the infinite recursion it hid, and the fabrication together.)
const BASELINE = {
  'alm/data-privacy.service.ts': 1, // `.catch(() => [])` on an expense query → SAR/GDPR export silently incomplete; log + surface the gap.
  'alm/alm-advisor.service.ts': 1, // `catch {}` when the AuditLog table is absent — best-effort daily-limit counter; should at least logger.debug the absent-table branch.
  'alm/alm-enterprise.service.ts': 1, // `catch {}` at ~:970 whose comment claims an EVE fallback that ISN'T there — nothing runs; log + actually fall back, or surface a gap.
  'alm/reports/report-preflight.service.ts': 1, // `catch {}` silently skips an unregistered model — preflight should record the skipped model in its gap list.
  'alm/treasury-rates.service.ts': 1, // `catch { /* skip */ }` drops a failed rate parse silently — log which rate key failed so a stale curve is visible.
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
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ─── Classifier ──────────────────────────────────────────────────────────
//   { status: 'none' }                              — out of scope / 0 swallows
//   { status: 'baselined', count, baseline }        — at/under baseline
//   { status: 'violation', count, baseline, reason }— new file OR grew past baseline
export function classify(content, relPath) {
  if (!relPath.startsWith(SCOPE_PREFIX)) return { status: 'none' };
  const { total } = countSwallows(content);
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
  if (process.env.VERIFY_NO_SILENT_CATCH_SKIP === '1') {
    console.log(
      'verify-no-silent-catch: skipped (VERIFY_NO_SILENT_CATCH_SKIP=1)',
    );
    process.exit(0);
  }
  if (!existsSync(ALM_ROOT)) {
    console.error(`verify-no-silent-catch: src/alm not found at ${ALM_ROOT}`);
    process.exit(1);
  }

  const files = walkTs(ALM_ROOT);
  let baselined = 0;
  let baselinedSwallows = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;
    if (result.status === 'baselined') {
      baselined++;
      baselinedSwallows += result.count;
      baselineHits.add(rel);
    } else {
      // a baselined file that grew is still "hit" (don't double-report as stale)
      if (rel in BASELINE) baselineHits.add(rel);
      violations.push(result.reason ? { rel, ...result } : { rel, ...result });
    }
  }

  const stale = Object.keys(BASELINE).filter((k) => !baselineHits.has(k));

  console.log(`verify-no-silent-catch: scanned ${files.length} src/alm files`);
  console.log(
    `  ${baselined} baselined file(s) / ${baselinedSwallows} known swallow(s) · ${violations.length} violation(s)`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n✓→ Stale baseline entries (swallows now 0 — remove + take the chip-away credit):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log('\n❌ Silent error-swallow(s) in src/alm (BLOCKING):');
    for (const v of violations) {
      console.log(
        `  - ${v.rel}  [${v.count} swallow(s), baseline ${v.baseline} — ${v.reason}]`,
      );
    }
    console.log('\n  Fix: do not swallow. On catch, either rethrow, or');
    console.log(
      '       this.logger.warn/error(...) AND surface the gap to the',
    );
    console.log(
      "       caller (a DataGap / status: 'data_unavailable') so the",
    );
    console.log(
      '       failure is visible, never a phantom zero. If a swallow is',
    );
    console.log(
      '       genuinely best-effort, bump its count in BASELINE with a',
    );
    console.log('       one-line reason.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    `\n✓ no-silent-catch: no new swallows. ${baselined} file(s) / ${baselinedSwallows} swallow(s) remain on the chip-away ledger.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'arrow-catch returning null in alm → violation',
      content: `const x = await foo().catch(() => null);`,
      rel: 'alm/new.service.ts',
      expected: 'violation',
    },
    {
      name: 'arrow-catch returning [] in alm → violation',
      content: `const rows = await q().catch(() => []);`,
      rel: 'alm/new2.service.ts',
      expected: 'violation',
    },
    {
      name: 'arrow-catch returning ({...}) in alm → violation',
      content: `const r = await c().catch(() => ({ items: [] }));`,
      rel: 'alm/new3.service.ts',
      expected: 'violation',
    },
    {
      name: 'logged arrow-catch → none (does not start with a swallow literal)',
      content: `await foo().catch((e) => this.logger.error(e));`,
      rel: 'alm/logged.service.ts',
      expected: 'none',
    },
    {
      name: 'rethrowing arrow-catch → none',
      content: `await foo().catch((e) => { throw e; });`,
      rel: 'alm/rethrow.service.ts',
      expected: 'none',
    },
    {
      name: 'empty catch block → violation',
      content: `try { go(); } catch (e) {}`,
      rel: 'alm/empty.service.ts',
      expected: 'violation',
    },
    {
      name: 'comment-only catch block → violation (comment stripped)',
      content: `try { go(); } catch { /* non-critical */ }`,
      rel: 'alm/commentcatch.service.ts',
      expected: 'violation',
    },
    {
      name: 'logged catch block → none',
      content: `try { go(); } catch (e) { this.logger.warn(e); }`,
      rel: 'alm/loggedblock.service.ts',
      expected: 'none',
    },
    {
      name: 'clean file, no catch → none',
      content: `export function add(a, b) { return a + b; }`,
      rel: 'alm/clean.service.ts',
      expected: 'none',
    },
    {
      name: 'swallow outside src/alm → none (out of scope)',
      content: `await foo().catch(() => null);`,
      rel: 'jobs/cleanup.service.ts',
      expected: 'none',
    },
    {
      name: 'a // comment mentioning catch {} → none (stripped)',
      content: `// the previous catch {} was a bug\nexport const x = 1;`,
      rel: 'alm/mentions.service.ts',
      expected: 'none',
    },
    {
      name: 'baselined file AT its count → baselined',
      content: `await a().catch(() => null);`, // count 1, baseline 1
      rel: 'alm/data-privacy.service.ts',
      expected: 'baselined',
    },
    {
      name: 'baselined file GROWN past its count → violation',
      content: `await a().catch(() => null);\nawait b().catch(() => null);`, // count 2 > baseline 1
      rel: 'alm/data-privacy.service.ts',
      expected: 'violation',
    },
  ];

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
