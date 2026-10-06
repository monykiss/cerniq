#!/usr/bin/env node
// scripts/verify-coverage-floor.mjs
//
// Guards the guard: makes CLAUDE.md D24 #3 — "coverage thresholds only
// RAISE; loosening requires an explicit decision + a SESSION_HANDOFF §5
// entry" — actually ENFORCED, not just documented.
//
// THE SILENT-GREEN THIS CLOSES (the meta one):
//   Every other gate this session stops a pass that lies — a fabricated
//   number, a swallowed error, a focused test, an unrun self-test. This
//   stops the deepest one: WEAKENING THE BAR ITSELF. In a multi-session
//   shared tree where everyone races to keep CI green, the tempting
//   shortcut for a failing build is to edit jest.coverageThreshold *down*
//   (or delete it). Nothing prevented that. A lowered floor is a silent
//   green: red code passes because the gate was quietly loosened.
//
// WHAT THIS DOES:
//   Reads backend-node/package.json jest.coverageThreshold.global and
//   fails if any metric is BELOW the locked floor, or if the threshold
//   block was removed. RAISING is always allowed (that is the ratchet).
//   To ratchet the LOCK itself upward, bump LOCKED below + name it in a
//   §5 entry. To justifiably LOWER (rare), set VERIFY_COVERAGE_FLOOR_SKIP=1
//   for that commit AND record the reason in §5 — exactly the "explicit
//   decision" D24 #3 requires.
//
// Exit codes:
//   0 — every metric at or above the locked floor
//   1 — a metric dropped below the floor, or the threshold block is gone
//
// Skip with VERIFY_COVERAGE_FLOOR_SKIP=1 (the audited "explicit decision").

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..', 'package.json');

// ─── Locked floor (measured 2026-06-07; ratchet UP only) ─────────────────
// These are the current jest.coverageThreshold.global values. The gate
// blocks any drop below them. When the real floor is legitimately raised,
// bump these to match (with a §5 entry) so the lock tracks the ceiling of
// what has been achieved.
const LOCKED = {
  statements: 86,
  branches: 70,
  functions: 81,
  lines: 86,
};
const METRICS = Object.keys(LOCKED);

// ─── Pure comparator (testable) ──────────────────────────────────────────
//   { status: 'ok' }
//   { status: 'missing' }                     — no threshold block at all
//   { status: 'dropped', drops: [{metric, current, locked}] }
export function classify(coverageThresholdGlobal, locked = LOCKED) {
  if (!coverageThresholdGlobal || typeof coverageThresholdGlobal !== 'object') {
    return { status: 'missing' };
  }
  const drops = [];
  for (const m of Object.keys(locked)) {
    const current = coverageThresholdGlobal[m];
    if (typeof current !== 'number' || current < locked[m]) {
      drops.push({ metric: m, current: current ?? '(absent)', locked: locked[m] });
    }
  }
  return drops.length === 0 ? { status: 'ok' } : { status: 'dropped', drops };
}

function readThreshold() {
  const pkg = JSON.parse(readFileSync(PKG, 'utf-8'));
  return pkg?.jest?.coverageThreshold?.global;
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_COVERAGE_FLOOR_SKIP === '1') {
    console.log('verify-coverage-floor: skipped (VERIFY_COVERAGE_FLOOR_SKIP=1)');
    process.exit(0);
  }

  const global = readThreshold();
  const result = classify(global);

  console.log('verify-coverage-floor: backend jest.coverageThreshold.global');
  console.log(
    `  locked floor: ${METRICS.map((m) => `${m[0]}=${LOCKED[m]}`).join(' ')}` +
      (global
        ? ` · current: ${METRICS.map((m) => `${m[0]}=${global[m] ?? '∅'}`).join(' ')}`
        : ' · current: (no threshold block!)'),
  );

  if (result.status === 'missing') {
    console.log(
      '\n❌ jest.coverageThreshold.global is GONE — coverage gating was removed (BLOCKING).',
    );
    console.log('   Restore the threshold block. Removing it disables the floor entirely.');
    process.exit(1);
  }
  if (result.status === 'dropped') {
    console.log('\n❌ Coverage floor LOWERED below the lock (BLOCKING):');
    for (const d of result.drops) {
      console.log(`  - ${d.metric}: ${d.current} < locked ${d.locked}`);
    }
    console.log('\n  D24 #3: thresholds only RAISE. To lower (rare, justified),');
    console.log('  set VERIFY_COVERAGE_FLOOR_SKIP=1 for the commit AND record the');
    console.log('  reason in a SESSION_HANDOFF §5 entry — the "explicit decision".');
    process.exit(1);
  }

  console.log('\n✓ coverage-floor: backend thresholds at or above the locked floor.');
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const L = { statements: 86, branches: 70, functions: 81, lines: 86 };
  const cases = [
    {
      name: 'exactly at floor → ok',
      input: { statements: 86, branches: 70, functions: 81, lines: 86 },
      expected: 'ok',
    },
    {
      name: 'all raised → ok (ratchet up allowed)',
      input: { statements: 90, branches: 75, functions: 85, lines: 90 },
      expected: 'ok',
    },
    {
      name: 'branches dropped 70→69 → dropped',
      input: { statements: 86, branches: 69, functions: 81, lines: 86 },
      expected: 'dropped',
    },
    {
      name: 'statements dropped → dropped',
      input: { statements: 80, branches: 70, functions: 81, lines: 86 },
      expected: 'dropped',
    },
    {
      name: 'one metric absent → dropped',
      input: { statements: 86, branches: 70, functions: 81 },
      expected: 'dropped',
    },
    {
      name: 'threshold block missing entirely → missing',
      input: undefined,
      expected: 'missing',
    },
    {
      name: 'threshold not an object → missing',
      input: 86,
      expected: 'missing',
    },
    {
      name: 'mixed raise + drop → dropped (the drop wins)',
      input: { statements: 99, branches: 60, functions: 99, lines: 99 },
      expected: 'dropped',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const r = classify(c.input, L);
    if (r.status === c.expected) pass++;
    else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${r.status}`);
    }
  }

  // Parity: the live LOCKED must match what main() enforces, and be all-numeric.
  const badLock = Object.entries(LOCKED).filter(([, v]) => typeof v !== 'number');
  if (badLock.length === 0) pass++;
  else {
    fail++;
    console.log(`✗ LOCKED has non-numeric entries: ${badLock.map(([k]) => k).join(', ')}`);
  }

  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
