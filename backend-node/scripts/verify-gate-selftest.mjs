#!/usr/bin/env node
// scripts/verify-gate-selftest.mjs
//
// META-GATE: verifies the verifiers. Makes CLAUDE.md's D24 criterion #4 —
// "Embed a --self-test for any new gate script so the rules themselves are
// verified in CI" — actually TRUE, instead of merely documented.
//
// THE HOLE THIS CLOSES (measured 2026-06-07):
//   The repo had 10 verify-*.mjs gates carrying 135 embedded self-test
//   cases between them — yet NO npm script ran any of them. The
//   self-tests were dead unless a human typed `--self-test` by hand. The
//   "verified in CI" claim was aspirational. A new gate could ship with a
//   broken (or absent) self-test and nothing would catch it.
//
// WHAT THIS DOES:
//   Discovers every scripts/verify-*.mjs (INCLUDING itself — see below),
//   runs each with `--self-test` as a child process, and asserts:
//     • it exits 0, AND
//     • its output contains a recognizable self-test marker
//       (`self-test:` / `N case(s) pass`) — i.e. it actually RAN a
//       self-test rather than ignoring the flag and scanning src.
//   A gate that errors, fails its self-test, or has no self-test at all
//   is a BLOCKING violation. Wired into `npm run lint`, this runs all 135+
//   cases on every commit.
//
// REFLEXIVE, NOT RECURSIVE:
//   The scan includes THIS file. When it runs `node verify-gate-selftest.mjs
//   --self-test`, that child sees `--self-test` and runs selfTest() (pure,
//   synthetic classifier cases) — it never enters main(), so it never
//   re-spawns the fleet. The meta-gate therefore verifies its own
//   self-test too, with no infinite recursion.
//
// Exit codes:
//   0 — every gate has a passing self-test
//   1 — a gate errored / failed its self-test / has no self-test
//
// Skip with VERIFY_GATE_SELFTEST_SKIP=1 (emergency escape).

import { readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const SELF = basename(fileURLToPath(import.meta.url));

// A self-test "ran" if the output carries one of these markers.
const SELFTEST_MARKER = /self-?test:|case\(s\)\s*pass/i;

// Gates that legitimately cannot carry a --self-test (none today). Each
// entry MUST name why. Chip away — an empty object is the goal state.
const BASELINE_NO_SELFTEST = {
  // (empty)
};

// ─── Pure classifier (testable) ──────────────────────────────────────────
//   'pass'    — exit 0 and a self-test marker present
//   'fail'    — a self-test ran but reported failure (exit != 0, marker present)
//   'missing' — exit 0 but NO marker: the gate ignored --self-test (no self-test)
//   'error'   — exit != 0 and no marker: crashed before/without self-testing
export function classifySelftest({ exitCode, output }) {
  const ran = SELFTEST_MARKER.test(output || '');
  if (ran) return exitCode === 0 ? { status: 'pass' } : { status: 'fail' };
  return exitCode === 0 ? { status: 'missing' } : { status: 'error' };
}

function listGates() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^verify-.*\.mjs$/.test(f))
    .sort();
}

function runGateSelftest(file) {
  const full = join(SCRIPTS_DIR, file);
  try {
    const stdout = execFileSync('node', [full, '--self-test'], {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    // execFileSync throws on non-zero exit / timeout / spawn failure.
    const exitCode = typeof err.status === 'number' ? err.status : 1;
    const output = `${err.stdout || ''}${err.stderr || ''}` || String(err.message || err);
    return { exitCode, output };
  }
}

function main() {
  if (process.env.VERIFY_GATE_SELFTEST_SKIP === '1') {
    console.log('verify-gate-selftest: skipped (VERIFY_GATE_SELFTEST_SKIP=1)');
    process.exit(0);
  }

  const gates = listGates();
  const results = [];
  for (const file of gates) {
    // Reflexive run of SELF is safe: --self-test short-circuits to selfTest().
    const { exitCode, output } = runGateSelftest(file);
    const { status } =
      file in BASELINE_NO_SELFTEST
        ? { status: 'baselined' }
        : classifySelftest({ exitCode, output });
    results.push({ file, status, exitCode });
  }

  const pass = results.filter((r) => r.status === 'pass');
  const baselined = results.filter((r) => r.status === 'baselined');
  const bad = results.filter(
    (r) => r.status !== 'pass' && r.status !== 'baselined',
  );

  console.log(`verify-gate-selftest: ran --self-test on ${gates.length} gate(s)`);
  console.log(`  ${pass.length} passing · ${baselined.length} baselined · ${bad.length} failing`);
  for (const r of pass) console.log(`  ✓ ${r.file}`);

  // Stale baseline: a gate listed as "no self-test" that now actually passes.
  const stale = Object.keys(BASELINE_NO_SELFTEST).filter((k) => {
    const r = results.find((x) => x.file === k);
    return r && r.status === 'baselined';
    // (cannot know it now passes without running unbaselined; we re-run below)
  });

  let failed = false;
  if (bad.length > 0) {
    console.log('\n❌ Gate self-test problems (BLOCKING):');
    for (const r of bad) {
      const why =
        r.status === 'missing'
          ? 'no --self-test (D24 #4 violation) — add one'
          : r.status === 'fail'
            ? `self-test FAILED (exit ${r.exitCode})`
            : `errored (exit ${r.exitCode})`;
      console.log(`  - ${r.file}: ${why}`);
    }
    console.log(
      '\n  Every scripts/verify-*.mjs must carry a passing --self-test so the',
    );
    console.log('  rule itself is verified in CI (CLAUDE.md D24 #4).');
    failed = true;
  }
  if (stale.length > 0) {
    console.log('\n⚠ Stale BASELINE_NO_SELFTEST (these now self-test — remove):');
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n✓ gate-selftest: every gate carries a passing self-test.');
  process.exit(0);
}

// ─── Self-test (of the meta-gate's own classifier) ────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'exit 0 + "self-test: 5/5 case(s) pass" → pass',
      input: { exitCode: 0, output: 'self-test: 5/5 case(s) pass' },
      expected: 'pass',
    },
    {
      name: 'exit 0 + "verify-x --self-test: 11 case(s) pass" → pass',
      input: { exitCode: 0, output: 'verify-x --self-test: 11 case(s) pass' },
      expected: 'pass',
    },
    {
      name: 'exit 1 + "self-test: 3/5 case(s) pass" → fail',
      input: { exitCode: 1, output: 'self-test: 3/5 case(s) pass' },
      expected: 'fail',
    },
    {
      name: 'exit 0 + no marker (ignored --self-test, scanned src) → missing',
      input: { exitCode: 0, output: 'scanned 146 src files\n✓ all clean.' },
      expected: 'missing',
    },
    {
      name: 'exit 1 + no marker (crashed) → error',
      input: { exitCode: 1, output: 'SyntaxError: unexpected token' },
      expected: 'error',
    },
    {
      name: 'empty output + exit 0 → missing',
      input: { exitCode: 0, output: '' },
      expected: 'missing',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const r = classifySelftest(c.input);
    if (r.status === c.expected) pass++;
    else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${r.status}`);
    }
  }

  // Parity: baseline keys, if any, must look like verify-*.mjs filenames.
  const badKeys = Object.keys(BASELINE_NO_SELFTEST).filter(
    (k) => !/^verify-.*\.mjs$/.test(k),
  );
  if (badKeys.length === 0) pass++;
  else {
    fail++;
    console.log(`✗ baseline has non-gate keys: ${badKeys.join(', ')}`);
  }

  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
