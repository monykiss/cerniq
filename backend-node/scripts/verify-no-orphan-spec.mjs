#!/usr/bin/env node
/**
 * verify-no-orphan-spec.mjs — CI guard against orphan spec files in backend-node.
 *
 * Mirror of frontend/scripts/verify-no-orphan-tests.mjs (commit 6cf84233),
 * adapted for backend's `.spec.ts` convention + separate integration `test/`
 * root. Closes the explicit follow-up flagged in 6cf84233's body — that
 * commit deferred a backend version "until backend conventions settle."
 *
 * Six classifications — a spec is OK if ANY rule matches:
 *
 *   (A) CO-LOCATED   — `<dir>/Foo.spec.ts` paired to `<dir>/Foo.ts`.
 *       Dominant convention (~382 files).
 *
 *   (B) __TESTS__    — `<dir>/__tests__/Foo.spec.ts` paired to `<dir>/Foo.ts`
 *       one level up. Used in agent-api, options, agents, top-level src.
 *
 *   (C) INTEGRATION  — anything under `backend-node/test/` is exempt. Those
 *       are integration / e2e specs that have no required source pair
 *       (they exercise composite flows, not individual modules).
 *
 *   (D) SUFFIX-STRIP — `<dir>/Foo.<aspect>.spec.ts` paired to `<dir>/Foo.ts`
 *       by iteratively stripping trailing `.<segment>` until a source is
 *       found. Handles the `.enhanced` / `.security` / `.deadline` / `.cost`
 *       aspect-suffix convention (e.g. `auth.guard.enhanced.spec.ts` →
 *       `auth.guard.ts`, `ai-advisor.controller.security.spec.ts` →
 *       `ai-advisor.controller.ts`). Symmetric for both co-located and
 *       __tests__ subdirs.
 *
 *   (E) DIR-SUITE    — `<dir>/<dirname>.spec.ts` is a multi-module suite
 *       (e.g. `common/decorators/decorators.spec.ts` exercises all decorators
 *       in the folder). Allowed when the spec's basename equals its
 *       directory name (case-insensitive). Mirrors frontend's rule (3).
 *
 *   (F) __TESTS__-DEEP — spec in `__tests__/` paired by basename to ANY
 *       `<base>.ts` under the parent of `__tests__/`. Covers the convention
 *       of grouping multi-module specs under a single `__tests__/` directory
 *       (e.g. `agents/__tests__/agent-runner.service.spec.ts` finding source
 *       at `agents/runner/agent-runner.service.ts`).
 *
 *   (G) SKIP COMMENT — spec carries `// verify:no-orphan-spec-skip — <reason>`
 *       in the first 50 lines. Ad-hoc opt-out for cross-cutting keystone
 *       specs (e.g. `report-accuracy.spec.ts`, `golden-reconciliation.spec.ts`)
 *       that exercise composite contracts without a 1:1 module pair.
 *
 *   (H) BASELINE — explicit `BASELINE_ORPHANS` const at the top of this script
 *       lists known legacy orphans with a one-line reason. Acts as a TODO
 *       list: future cleanup can chip away at the baseline. The script also
 *       warns (but does not fail) when a baseline entry is no longer an
 *       orphan — that's the trigger to remove the entry.
 *
 * Anything else is an orphan and exits non-zero.
 *
 * Wired into `npm run lint` next to verify:tenant-scope. Run standalone via
 * `node scripts/verify-no-orphan-spec.mjs`.
 *
 * Flags:
 *   (none)        scan + report; exit 1 on any orphan
 *   --quiet       suppress per-orphan detail; final summary only
 *   --self-test   exercise the pairing rules against fixture cases
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_ROOT = join(ROOT, 'src');
const TEST_ROOT = join(ROOT, 'test');
const SPEC_RE = /\.(?:e2e-)?spec\.ts$/;
const SKIP_RE = /\/\/\s*verify:no-orphan-spec-skip\s*—\s*\S/;

/**
 * Known legacy orphans — specs that don't fit rules A-G and predate this
 * guard. The path is relative to `backend-node/`. Each entry should carry
 * a one-line reason explaining why the spec exists without a 1:1 source.
 *
 * Convention: chip away over time. Removing an entry should be paired with
 * either (a) moving the spec next to its source, (b) deleting the spec if
 * the source is truly gone, or (c) adding a `verify:no-orphan-spec-skip`
 * comment to the spec file itself if it's a cross-cutting keystone.
 *
 * The script warns when a baseline entry no longer points at an orphan
 * (someone fixed it) — that's the cue to remove the entry from this list.
 */
const BASELINE_ORPHANS = new Set([
  // Cross-cutting keystone specs — exercise composite contracts, no 1:1 source.
  'src/alm/report-accuracy.spec.ts', // empty-institution end-to-end contract (see SESSION_HANDOFF §2 Phase 2)
  'src/alm/golden-reconciliation.spec.ts', // pr-cooperativa-demo fixture reconciliation (see SESSION_HANDOFF §2 Phase 2)
  'src/agent-eval/cross-agent-regression.spec.ts', // cross-agent regression harness
  'src/agent-api/__tests__/rls-isolation.spec.ts', // RLS integration across all agent tables
  'src/agents/__tests__/contracts.spec.ts', // multi-contract conformance suite
  'src/portal/portal-export.integration.spec.ts', // composite portal-export integration

  // Specs whose source location has drifted; spec is real, jest runs it.
  // Future cleanup: move source next to spec, or move spec next to source.
  'src/__tests__/sentry-scrubber.spec.ts',
  'src/agents/alert-notifier/agent-alert-notifier.spec.ts',
  'src/agents/runner/agent-runner.deadline.spec.ts',
  'src/agents/runner/llm-bridge.cost.spec.ts',
  'src/agents/scheduler/agent-scheduler.spec.ts',
  'src/alm/quant/credit/credit-risk.spec.ts',
  'src/close/gl-snapshot-inspector.spec.ts',
  'src/common/interceptors/metrics.interceptor.spec.ts',
  'src/governance/governance.service.spec.ts',
]);

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const SELF_TEST = argv.includes('--self-test');

function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function hasSource(dir, base) {
  return fileExists(join(dir, `${base}.ts`));
}

function hasSkipComment(specPath) {
  try {
    const head = readFileSync(specPath, 'utf8')
      .split('\n')
      .slice(0, 50)
      .join('\n');
    return SKIP_RE.test(head);
  } catch {
    return false;
  }
}

/**
 * Try the spec's full basename, then iteratively strip a trailing `.segment`
 * until a source is found or no dots remain. Returns the matching source
 * basename, or null.
 */
function findSourceWithSuffixStrip(dir, base) {
  let candidate = base;
  while (true) {
    if (hasSource(dir, candidate)) return candidate;
    if (!candidate.includes('.')) return null;
    candidate = candidate.replace(/\.[^.]+$/, '');
  }
}

/**
 * Walk a subtree looking for a file named `<base>.ts`. Returns true if any
 * file with that exact basename exists anywhere under `root`. Used by
 * Rule F (__tests__-deep).
 */
function hasSourceInSubtree(root, base) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.name === '__tests__') continue;
    if (entry.isFile() && entry.name === `${base}.ts`) return true;
    if (entry.isDirectory()) {
      if (hasSourceInSubtree(join(root, entry.name), base)) return true;
    }
  }
  return false;
}

function classify(specPath) {
  if (specPath.startsWith(TEST_ROOT + '/') || specPath === TEST_ROOT)
    return 'integration';

  const dir = dirname(specPath);
  const file = basename(specPath);
  const base = file.replace(SPEC_RE, '');

  // Rule A: exact co-located
  if (hasSource(dir, base)) return 'co-located';

  // Rule B: __tests__ subdir, exact match one level up
  const isTestsDir = basename(dir) === '__tests__';
  if (isTestsDir && hasSource(dirname(dir), base)) return '__tests__';

  // Rule D: suffix-strip (both co-located and __tests__ variants)
  if (base.includes('.')) {
    if (findSourceWithSuffixStrip(dir, base)) return 'suffix-strip';
    if (isTestsDir && findSourceWithSuffixStrip(dirname(dir), base))
      return 'suffix-strip';
  }

  // Rule E: dir-suite (basename matches dirname, case-insensitive)
  if (basename(dir).toLowerCase() === base.toLowerCase()) return 'dir-suite';

  // Rule F: __tests__-deep — search the parent's subtree for <base>.ts
  if (isTestsDir && hasSourceInSubtree(dirname(dir), base))
    return '__tests__-deep';

  // Rule G: explicit skip comment
  if (hasSkipComment(specPath)) return 'skip';

  return null;
}

function runSelfTest() {
  const fakeFiles = new Set([
    'src/Foo.ts',
    'src/Foo.spec.ts',
    'src/x/Bar.ts',
    'src/x/__tests__/Bar.spec.ts',
    'test/integration.spec.ts',
    'test/app.e2e-spec.ts',
    'src/y/Orphan.spec.ts',
    'src/z/__tests__/Gone.spec.ts',
    'src/SpecialCase.spec.ts',
    'src/auth/auth.guard.ts',
    'src/auth/auth.guard.enhanced.spec.ts',
    'src/agents/runner/agent-runner.ts',
    'src/agents/runner/agent-runner.deadline.spec.ts',
    'src/ai-advisor/ai-advisor.controller.ts',
    'src/ai-advisor/__tests__/ai-advisor.controller.security.spec.ts',
    'src/common/decorators/decorators.spec.ts',
    'src/common/decorators/Authorize.ts',
  ]);
  const fakeSkipFiles = new Set(['src/SpecialCase.spec.ts']);

  function classifyFake(spec) {
    if (spec.startsWith('test/')) return 'integration';
    const dir = dirname(spec);
    const file = basename(spec);
    const base = file.replace(SPEC_RE, '');
    const has = (d, b) => fakeFiles.has(`${d}/${b}.ts`);

    if (has(dir, base)) return 'co-located';

    const isTestsDir = basename(dir) === '__tests__';
    if (isTestsDir && has(dirname(dir), base)) return '__tests__';

    function findWithStrip(d, b) {
      let c = b;
      while (true) {
        if (has(d, c)) return c;
        if (!c.includes('.')) return null;
        c = c.replace(/\.[^.]+$/, '');
      }
    }
    if (base.includes('.')) {
      if (findWithStrip(dir, base)) return 'suffix-strip';
      if (isTestsDir && findWithStrip(dirname(dir), base))
        return 'suffix-strip';
    }

    if (basename(dir).toLowerCase() === base.toLowerCase()) return 'dir-suite';

    if (fakeSkipFiles.has(spec)) return 'skip';
    return null;
  }

  const cases = [
    { path: 'src/Foo.spec.ts', expected: 'co-located' },
    { path: 'src/x/__tests__/Bar.spec.ts', expected: '__tests__' },
    { path: 'test/integration.spec.ts', expected: 'integration' },
    { path: 'test/app.e2e-spec.ts', expected: 'integration' },
    { path: 'src/y/Orphan.spec.ts', expected: null },
    { path: 'src/z/__tests__/Gone.spec.ts', expected: null },
    { path: 'src/SpecialCase.spec.ts', expected: 'skip' },
    { path: 'src/auth/auth.guard.enhanced.spec.ts', expected: 'suffix-strip' },
    {
      path: 'src/agents/runner/agent-runner.deadline.spec.ts',
      expected: 'suffix-strip',
    },
    {
      path: 'src/ai-advisor/__tests__/ai-advisor.controller.security.spec.ts',
      expected: 'suffix-strip',
    },
    { path: 'src/common/decorators/decorators.spec.ts', expected: 'dir-suite' },
  ];

  const failures = [];
  for (const c of cases) {
    const got = classifyFake(c.path);
    if (got !== c.expected) {
      failures.push(
        `self-test FAIL: ${c.path}\n  expected: ${c.expected ?? 'orphan'}\n  got:      ${got ?? 'orphan'}`,
      );
    }
  }

  // Locked-in contract: skip comment must have a reason after the em-dash.
  const noReason = '// verify:no-orphan-spec-skip';
  const withReason =
    '// verify:no-orphan-spec-skip — wraps NestJS module bootstrap';
  if (SKIP_RE.test(noReason)) {
    failures.push('self-test FAIL: bare skip without reason should not match');
  }
  if (!SKIP_RE.test(withReason)) {
    failures.push('self-test FAIL: skip with reason should match');
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(
      `\nverify-no-orphan-spec --self-test: ${failures.length} failure(s)`,
    );
    process.exit(1);
  }
  console.log(
    `verify-no-orphan-spec --self-test: ${cases.length + 2} case(s) pass`,
  );
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

function* walkSpecs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSpecs(full);
    else if (entry.isFile() && SPEC_RE.test(entry.name)) yield full;
  }
}

const tally = {
  'co-located': 0,
  __tests__: 0,
  integration: 0,
  'suffix-strip': 0,
  'dir-suite': 0,
  '__tests__-deep': 0,
  skip: 0,
  baseline: 0,
};
const orphans = [];
const baselineHits = new Set();
let scanned = 0;

for (const root of [SRC_ROOT, TEST_ROOT]) {
  for (const file of walkSpecs(root)) {
    scanned += 1;
    const rule = classify(file);
    const rel = relative(ROOT, file);
    if (rule === null) {
      if (BASELINE_ORPHANS.has(rel)) {
        tally.baseline += 1;
        baselineHits.add(rel);
      } else {
        orphans.push(rel);
      }
    } else {
      // If a baselined path now classifies, flag it as stale.
      if (BASELINE_ORPHANS.has(rel)) baselineHits.add(rel);
      tally[rule] += 1;
    }
  }
}

// Stale baseline entries: in BASELINE_ORPHANS but the spec no longer exists
// or now classifies under a rule. Warn-only — not a failure.
const staleBaseline = [...BASELINE_ORPHANS].filter((p) => !baselineHits.has(p));

const summary =
  `verify-no-orphan-spec: ${scanned} spec file(s) scanned ` +
  `(${tally['co-located']} co-located, ${tally['__tests__']} __tests__, ` +
  `${tally['__tests__-deep']} __tests__-deep, ${tally['integration']} integration, ` +
  `${tally['suffix-strip']} suffix-strip, ${tally['dir-suite']} dir-suite, ` +
  `${tally['skip']} skipped, ${tally.baseline} baselined), ` +
  `${orphans.length} orphan(s).`;

if (staleBaseline.length > 0 && !QUIET) {
  console.warn(
    `verify-no-orphan-spec: ${staleBaseline.length} stale baseline entr(ies) — remove from BASELINE_ORPHANS:`,
  );
  for (const p of staleBaseline) console.warn(`  ${p}`);
  console.warn('');
}

if (orphans.length > 0) {
  if (!QUIET) {
    for (const o of orphans) console.error(`error orphan spec: ${o}`);
    console.error('');
    console.error('Each orphan must either:');
    console.error(
      '  (a) be deleted (the source it tested no longer exists), or',
    );
    console.error(
      '  (b) be moved into a __tests__/ subdir alongside the source it tests, or',
    );
    console.error(
      '  (c) be moved under backend-node/test/ if it is integration-scope, or',
    );
    console.error(
      '  (d) carry a `// verify:no-orphan-spec-skip — <reason>` comment in the first 50 lines.',
    );
  }
  console.error(summary);
  process.exit(1);
}

console.log(summary);
process.exit(0);
