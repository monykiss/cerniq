#!/usr/bin/env node
// scripts/verify-no-unseeded-random.mjs
//
// Enforces a MODEL-GOVERNANCE invariant: quant / financial code in src/alm
// must be REPRODUCIBLE — identical inputs must yield identical outputs — and
// must never fabricate a missing input from noise. The global `Math.random()`
// violates BOTH at once:
//   1. It is NON-DETERMINISTIC. A number that changes every call cannot be
//      reproduced, audited, back-tested, or independently validated — a direct
//      model-risk-management red flag (SR 11-7 / model validation). Every real
//      Monte-Carlo engine in this repo already avoids it: hjm/monte-carlo,
//      frtb-es, copula-credit, credit-metrics all use a SEEDED xorshift/
//      splitmix PRNG precisely so a run is reproducible.
//   2. In several live offenders it INVENTS data that is then shown to an
//      examiner as real:
//        • nim-attribution.service.ts — the PRIOR-period NIM is
//          `nimCurrent + 0.15 + (Math.random()-0.5)*0.3`, so the whole 7-factor
//          NIM-change waterfall is a decomposition of a RANDOM delta: noise
//          dressed as a regulatory bridge. (Also on the D1 + no-silent-catch
//          ledgers — the empty path is a getDemo + swallowing catch.)
//        • portfolio-var.service.ts — historical-VaR scenarios are generated
//          with Math.random() ("market" shocks), so the reported VaR/ES is a
//          phantom risk number, different on every run.
//        • cvar-optimizer.service.ts — CVaR sampling + Box-Muller draws from
//          Math.random(), so the "optimal" allocation is non-reproducible.
//
// THIS IS NOT verify:rule-12-crypto-randomness. Rule 12 governs SECURITY-path
// randomness (it wants crypto-grade entropy for tokens/nonces). THIS gate
// governs QUANT-path randomness (it wants seeded, reproducible determinism).
// Both forbid bare Math.random() — for opposite reasons, in different scopes. A
// weak-random ID (reports.service.ts) is neither a metric nor a security token;
// it is baselined here with a note pointing at crypto.randomUUID().
//
// THE ANTI-PATTERN (comments stripped FIRST, so a comment that merely mentions
// Math.random — e.g. monte-carlo.service.ts's note about why it AVOIDS it —
// does NOT count): a call to the global `Math.random(` (any internal
// whitespace). It does NOT flag a seeded `this.rng.next()` or a bare reference
// `const f = Math.random` without a call — narrow on purpose (near-zero false
// positives); a seeded-PRNG migration is the behavioural backstop.
//
// Count-based (mirrors verify-no-silent-catch / verify-rule-11): a file fails
// if its Math.random() count EXCEEDS baseline (within-file regression) or it is
// a NEW file with any call. Driving a file to 0 makes its baseline entry stale
// (remove it, take the chip-away credit). Fix = replace Math.random() with a
// SEEDED PRNG (see backend-node/src/alm/quant/hjm/monte-carlo.ts) and, where
// the random was fabricating a missing input, an honest data_unavailable +
// DataGap instead of inventing one.
//
// Exit codes:
//   0 — every src/alm file is clean or at/under baseline; no stale entries
//   1 — a new/grown call appeared, or a baseline entry is stale
//
// Skip the script entirely with VERIFY_NO_UNSEEDED_RANDOM_SKIP=1.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const SCOPE_PREFIX = 'alm/';
const ALM_ROOT = join(SRC_ROOT, 'alm');

// The global unseeded PRNG. Matches `Math.random(` with any internal
// whitespace; does NOT match `Math.randomBytes(` (the char after `random` is a
// letter, not `(`), a seeded `rng.random(`, or a property like `mathRandom`.
const MATH_RANDOM = /\bMath\s*\.\s*random\s*\(/g;

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

export function countRandom(content) {
  const code = stripComments(content);
  return (code.match(MATH_RANDOM) || []).length;
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// relPath (from src/) → known Math.random() call count. Drive a count to 0 and
// remove the entry; the stale detector fails CI if you forget. Each entry names
// the remediation: swap Math.random() for a SEEDED PRNG and, where it fabricated
// a missing input, an honest data_unavailable + DataGap.
//
// Locked 2026-06-08: 2 entries / 4 calls. 0 unbaselined. monte-carlo.service.ts
// is NOT here — its only `Math.random` is a comment explaining what it avoids
// (stripped before counting).
// (nim-attribution.service.ts cleared 2026-06-08: the Math.random()-perturbed
//  prior was deleted in the D1 sweep — the prior-period NIM now comes from the
//  most recent BoardReport.nimSnapshot, so the attribution is deterministic.)
// (portfolio-var.service.ts cleared 2026-06-08: the 7 Math.random() draws AND
//  the unseeded crypto.randomBytes Monte Carlo were replaced with a seeded
//  xorshift32 PRNG (institution-hash seed). The historical-simulation + Kupiec
//  paths now run over a SYNTHETIC distribution, honestly relabelled `simulated`
//  + disclosed via DataGaps — no longer mislabelled empirical history.)
const BASELINE = {
  // cvar-optimizer.service.ts CLEARED 2026-06-08 (was 3): CVaR sampling +
  // Box-Muller now draw from a seeded xorshift32 + Box-Muller stream keyed by an
  // FNV-1a hash of the institution id → reproducible "optimal" allocation.
  'alm/reports/reports.service.ts': 1, // report-ID suffix, NOT a financial metric — non-reproducible id; prefer crypto.randomUUID() (Rule-12-adjacent). Low priority.
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
//   { status: 'none' }                              — out of scope / 0 calls
//   { status: 'baselined', count, baseline }        — at/under baseline
//   { status: 'violation', count, baseline, reason }— new file OR grew past baseline
export function classify(content, relPath) {
  if (!relPath.startsWith(SCOPE_PREFIX)) return { status: 'none' };
  const total = countRandom(content);
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
  if (process.env.VERIFY_NO_UNSEEDED_RANDOM_SKIP === '1') {
    console.log(
      'verify-no-unseeded-random: skipped (VERIFY_NO_UNSEEDED_RANDOM_SKIP=1)',
    );
    process.exit(0);
  }
  if (!existsSync(ALM_ROOT)) {
    console.error(
      `verify-no-unseeded-random: src/alm not found at ${ALM_ROOT}`,
    );
    process.exit(1);
  }

  const files = walkTs(ALM_ROOT);
  let baselined = 0;
  let baselinedCalls = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;
    if (result.status === 'baselined') {
      baselined++;
      baselinedCalls += result.count;
      baselineHits.add(rel);
    } else {
      if (rel in BASELINE) baselineHits.add(rel);
      violations.push({ rel, ...result });
    }
  }

  const stale = Object.keys(BASELINE).filter((k) => !baselineHits.has(k));

  console.log(
    `verify-no-unseeded-random: scanned ${files.length} src/alm files`,
  );
  console.log(
    `  ${baselined} baselined file(s) / ${baselinedCalls} known Math.random() call(s) · ${violations.length} violation(s)`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n✓→ Stale baseline entries (Math.random() now 0 — remove + take the chip-away credit):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log('\n❌ Unseeded Math.random() in src/alm (BLOCKING):');
    for (const v of violations) {
      console.log(
        `  - ${v.rel}  [${v.count} call(s), baseline ${v.baseline} — ${v.reason}]`,
      );
    }
    console.log(
      '\n  Fix: quant paths must be REPRODUCIBLE. Replace Math.random()',
    );
    console.log(
      '       with a SEEDED PRNG (see src/alm/quant/hjm/monte-carlo.ts).',
    );
    console.log(
      '       Where the random fabricated a missing input, return an',
    );
    console.log(
      '       honest data_unavailable + DataGap instead. If a use is',
    );
    console.log(
      '       genuinely best-effort, bump its count in BASELINE with a',
    );
    console.log('       one-line reason.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    `\n✓ no-unseeded-random: no new Math.random(). ${baselined} file(s) / ${baselinedCalls} call(s) remain on the chip-away ledger.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'Math.random() in alm → violation (new file)',
      content: `const x = Math.random();`,
      rel: 'alm/new.service.ts',
      expected: 'violation',
    },
    {
      name: 'Math . random ( with whitespace → violation (whitespace-tolerant)',
      content: `const x = Math . random ();`,
      rel: 'alm/spaced.service.ts',
      expected: 'violation',
    },
    {
      name: 'two calls on one line still classify as violation (count 2)',
      content: `const z = Math.random() + Math.random();`,
      rel: 'alm/two.service.ts',
      expected: 'violation',
    },
    {
      name: 'seeded PRNG (no Math.random) → none',
      content: `const r = this.rng.next(); const s = xorshift32(seed);`,
      rel: 'alm/seeded.service.ts',
      expected: 'none',
    },
    {
      name: 'crypto randomness (not Math.random) → none',
      content: `import { randomBytes } from 'crypto'; const b = randomBytes(16);`,
      rel: 'alm/crypto.service.ts',
      expected: 'none',
    },
    {
      name: 'Math.randomBytes-like is not matched (letter after random) → none',
      content: `const u = Math.round(2.4); const v = mathRandom();`,
      rel: 'alm/lookalike.service.ts',
      expected: 'none',
    },
    {
      name: 'bare reference `Math.random` without a call → none (known scope)',
      content: `const f = Math.random; void f;`,
      rel: 'alm/ref.service.ts',
      expected: 'none',
    },
    {
      name: 'line-comment mentioning Math.random() → none (stripped)',
      content: `// avoids Math.random() bias\nexport const x = 1;`,
      rel: 'alm/comment.service.ts',
      expected: 'none',
    },
    {
      name: 'block-comment mentioning Math.random() → none (stripped)',
      content: `/* do not use Math.random() here */\nexport const y = 2;`,
      rel: 'alm/block.service.ts',
      expected: 'none',
    },
    {
      name: 'clean file → none',
      content: `export function add(a, b) { return a + b; }`,
      rel: 'alm/clean.service.ts',
      expected: 'none',
    },
    {
      name: 'Math.random() outside src/alm → none (out of scope)',
      content: `const x = Math.random();`,
      rel: 'jobs/cleanup.service.ts',
      expected: 'none',
    },
    {
      name: 'baselined file AT its count → baselined',
      content: `const a = Math.random();`, // count 1, baseline 1
      rel: 'alm/reports/reports.service.ts',
      expected: 'baselined',
    },
    {
      name: 'baselined file GROWN past its count → violation',
      content: `const a = Math.random();\nconst b = Math.random();`, // count 2 > baseline 1
      rel: 'alm/reports/reports.service.ts',
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
