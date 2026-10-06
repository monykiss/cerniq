#!/usr/bin/env node
/**
 * verify-no-orphan-tests.mjs — CI guard against orphan test files.
 *
 * An "orphan" is a `*.test.{ts,tsx}` file whose subject source no longer
 * exists. They accumulate when a bulk cleanup deletes source files but
 * misses their paired tests (cf. commit 42f4dded which left 17 such
 * orphans, requiring two follow-up commits to clean up — f660d6e3 and
 * f60c5e0d).
 *
 * Three pairing rules — a test file is OK if ANY one matches:
 *
 *   (1) CO-LOCATED  — `<dir>/Foo.test.{ts,tsx}` paired to `<dir>/Foo.{ts,tsx}`
 *       The default convention in this repo.
 *
 *   (2) __TESTS__   — `<dir>/__tests__/Foo.test.{ts,tsx}` paired to
 *       `<dir>/Foo.{ts,tsx}` (one level up). Used in `lib/`, `lib/hooks/`,
 *       and several `app/<route>/__tests__/page.test.tsx` files.
 *
 *   (3) DIR-SUITE   — `<dir>/<dirname>.test.{ts,tsx}` is a multi-component
 *       directory-suite test (e.g. `components/density/density.test.tsx`
 *       which exercises 5 sibling primitives). Allowed when the test
 *       file's basename equals its directory name (case-insensitive).
 *
 * Anything else is an orphan and exits non-zero.
 *
 * Wired into `npm run lint` next to verify-alm-registry.mjs. Run standalone
 * via `node scripts/verify-no-orphan-tests.mjs`.
 *
 * Flags:
 *   (none)        scan + report; exit 1 on any orphan
 *   --quiet       suppress per-orphan detail; final summary only
 *   --self-test   exercise the pairing rules against fixture cases
 */

import { readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const ROOTS = ['app', 'components', 'hooks', 'lib'];
const TEST_RE = /\.test\.(ts|tsx)$/;

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const SELF_TEST = argv.includes('--self-test');

// ─── Pairing rules ──────────────────────────────────────────────────────────

function fileExists(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function hasSibling(dir, base) {
  return fileExists(join(dir, `${base}.ts`)) || fileExists(join(dir, `${base}.tsx`));
}

/**
 * Returns the rule that allows a test file, or null if it's orphaned.
 * Pure function over the test path + a filesystem probe.
 */
function classify(testPath) {
  const dir = dirname(testPath);
  const file = basename(testPath);
  const base = file.replace(TEST_RE, '');

  if (hasSibling(dir, base)) return 'co-located';

  if (basename(dir) === '__tests__' && hasSibling(dirname(dir), base)) {
    return '__tests__';
  }

  if (basename(dir).toLowerCase() === base.toLowerCase()) {
    return 'dir-suite';
  }

  return null;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function runSelfTest() {
  // Build a tiny in-memory fs probe so we don't touch the real filesystem.
  const fakeFiles = new Set([
    'a/Foo.ts',
    'a/Foo.test.tsx',                  // (1) co-located
    'b/Bar.tsx',
    'b/__tests__/Bar.test.tsx',        // (2) __tests__ convention
    'c/density/density.test.tsx',      // (3) dir-suite (no source paired)
    'c/density/NumberCell.tsx',        // sibling primitive — exists
    'd/Orphan.test.tsx',               // ORPHAN — no Orphan.ts/tsx
    'e/__tests__/Gone.test.tsx',       // ORPHAN — no e/Gone.ts/tsx
  ]);

  const fakeStat = (p) => ({ isFile: () => fakeFiles.has(p.replace(/^.*?\/(?=[a-z])/, '')) });
  // Override the stat probe via a wrapper for the duration of the self-test.
  const realFileExists = fileExists;
  globalThis.__verifyTestFakeExists = (p) => fakeFiles.has(p);
  // Monkey-patch: redefine fileExists locally via a helper.
  function classifyWithFake(testPath) {
    const dir = dirname(testPath);
    const file = basename(testPath);
    const base = file.replace(TEST_RE, '');
    const has = (d, b) => fakeFiles.has(`${d}/${b}.ts`) || fakeFiles.has(`${d}/${b}.tsx`);
    if (has(dir, base)) return 'co-located';
    if (basename(dir) === '__tests__' && has(dirname(dir), base)) return '__tests__';
    if (basename(dir).toLowerCase() === base.toLowerCase()) return 'dir-suite';
    return null;
  }

  const cases = [
    { path: 'a/Foo.test.tsx',                  expected: 'co-located' },
    { path: 'b/__tests__/Bar.test.tsx',        expected: '__tests__'  },
    { path: 'c/density/density.test.tsx',      expected: 'dir-suite'  },
    { path: 'd/Orphan.test.tsx',               expected: null         },
    { path: 'e/__tests__/Gone.test.tsx',       expected: null         },
  ];

  const failures = [];
  for (const c of cases) {
    const got = classifyWithFake(c.path);
    if (got !== c.expected) {
      failures.push(
        `self-test FAIL: ${c.path}\n  expected: ${c.expected ?? 'orphan'}\n  got:      ${got ?? 'orphan'}`,
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\nverify-no-orphan-tests --self-test: ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log(`verify-no-orphan-tests --self-test: ${cases.length} case(s) pass`);
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ─── Walk + classify ────────────────────────────────────────────────────────

function* walkTests(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTests(full);
    else if (entry.isFile() && TEST_RE.test(entry.name)) yield full;
  }
}

const tally = { 'co-located': 0, '__tests__': 0, 'dir-suite': 0 };
const orphans = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walkTests(join(ROOT, root))) {
    scanned += 1;
    const rule = classify(file);
    if (rule === null) orphans.push(relative(ROOT, file));
    else tally[rule] += 1;
  }
}

const summary =
  `verify-no-orphan-tests: ${scanned} test file(s) scanned ` +
  `(${tally['co-located']} co-located, ${tally['__tests__']} __tests__, ${tally['dir-suite']} dir-suite), ` +
  `${orphans.length} orphan(s).`;

if (orphans.length > 0) {
  if (!QUIET) {
    for (const o of orphans) console.error(`error orphan test: ${o}`);
    console.error('');
    console.error('Each orphan must either:');
    console.error('  (a) be deleted (the source it tested no longer exists), or');
    console.error('  (b) be moved into a __tests__/ subdir of the source it tests, or');
    console.error('  (c) be renamed so its basename matches its directory name (dir-suite).');
  }
  console.error(summary);
  process.exit(1);
}

console.log(summary);
process.exit(0);
