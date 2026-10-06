#!/usr/bin/env node
// scripts/verify-rule-12-crypto-randomness.mjs
//
// Enforces KLYTICS Audit Discipline Rule 12 (cryptographic randomness in
// security paths). See `docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` §1
// Rule 12 for normative text; this script is the CI lock that prevents
// new security-scope code from using the predictable PRNG.
//
// Rule of thumb:
//   In security-scope files (auth / agent-trust / crypto / audit /
//   billing / idempotency / admin / secrets / tenant / rbac, plus any
//   *.guard.ts / *.shield.ts / *.middleware.ts), randomness MUST come
//   from the node crypto module (randomBytes, randomUUID, getRandomValues).
//   The non-crypto PRNG is forbidden — predictable nonces / tokens are
//   a vulnerability.
//
//   In non-security paths (Monte-Carlo, options pricing, valuation,
//   simulation, slug/jitter utilities), the non-crypto PRNG is fine and
//   we don't flag it. Those paths get a count, not a violation.
//
// Mirrors Apex Round 4 (apex_session_20260409_pm_round4.md) which closed
// 18 files of the same anti-pattern.
//
// Exit codes:
//   0 — all security-scope files clean (or baselined)
//   1 — violation found or stale baseline entry
//
// Skip the script entirely with VERIFY_RULE_12_SKIP=1 (emergency escape).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

// ─── Patterns ──────────────────────────────────────────────────────────
// JSDoc note: the literal pattern below MUST be referenced only in
// prose in comments, never as a literal "Math" + dot + "random" token,
// or stripComments + the matcher together would still leave one stripped
// version intact. The pattern matches the bare function call only;
// destructured `const { random } = Math` is matched separately.
const PRNG_CALL = /\bMath\s*\.\s*random\s*\(/;
const PRNG_DESTRUCTURE = /\bconst\s*\{[^}]*\brandom\b[^}]*\}\s*=\s*Math\b/;

// Security-scope path prefixes (relative to src/).
const SECURITY_PREFIX =
  /^(auth|agent-trust|crypto|audit|billing|idempotency|admin|secrets|tenant|rbac)\//;

// Files in any path that are intrinsically security-scope by NestJS convention.
const SECURITY_FILENAME_SUFFIX = /\.(guard|shield|middleware)\.ts$/;

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

function isSecurityScope(relPath) {
  if (SECURITY_PREFIX.test(relPath)) return true;
  if (SECURITY_FILENAME_SUFFIX.test(relPath)) return true;
  return false;
}

// ─── Baseline ──────────────────────────────────────────────────────────
// Known security-scope files using the non-crypto PRNG. Each entry MUST
// include a one-line reason + remediation direction. Chip away over time
// — when a file is fixed, remove its entry and the stale-baseline
// detector will flag this script for cleanup.
//
// Priority key: HIGH = breaks an adversary-facing surface; MEDIUM =
// regulator-bound identifier that could be predicted.
const BASELINE_VIOLATIONS = {
  // Empty — agent-trust/prompt-injection.shield.ts was the sole entry,
  // cleared in the same PR that closed the Rule 12 follow-up.
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

// ─── Classifier ────────────────────────────────────────────────────────
//   { status: 'none' }                           — no PRNG call detected
//   { status: 'general' }                        — PRNG in non-security path; counted but not blocking
//   { status: 'baselined', reason }              — security-scope offender on the allowlist
//   { status: 'violation' }                      — security-scope PRNG (BLOCKING)
export function classify(content, relPath) {
  const codeOnly = stripComments(content);
  const hasPRNG = PRNG_CALL.test(codeOnly) || PRNG_DESTRUCTURE.test(codeOnly);
  if (!hasPRNG) return { status: 'none' };

  const security = isSecurityScope(relPath);
  if (!security) return { status: 'general' };

  if (relPath in BASELINE_VIOLATIONS) {
    return { status: 'baselined', reason: BASELINE_VIOLATIONS[relPath] };
  }
  return { status: 'violation' };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_RULE_12_SKIP === '1') {
    console.log(
      'verify-rule-12-crypto-randomness: skipped (VERIFY_RULE_12_SKIP=1)',
    );
    process.exit(0);
  }

  const files = walkTs(SRC_ROOT);
  let general = 0;
  let baselined = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC_ROOT, file);
    const result = classify(content, rel);
    if (result.status === 'none') continue;

    if (result.status === 'general') general++;
    else if (result.status === 'baselined') {
      baselined++;
      baselineHits.add(rel);
    } else if (result.status === 'violation') violations.push(rel);
  }

  const stale = Object.keys(BASELINE_VIOLATIONS).filter(
    (k) => !baselineHits.has(k),
  );

  console.log(
    `verify-rule-12-crypto-randomness: scanned ${files.length} src files`,
  );
  console.log(
    `  ${general} non-security PRNG hits (allowed) · ${baselined} baselined · ${violations.length} violations`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n⚠ Stale BASELINE_VIOLATIONS entries (no matching file — remove):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log('\n❌ Security-scope PRNG violations (BLOCKING):');
    for (const f of violations) console.log(`  - ${f}`);
    console.log(
      '\n  Fix: replace with `crypto.randomBytes(N)` / `crypto.randomUUID()` /',
    );
    console.log(
      '       `crypto.getRandomValues(buf)`. See `node:crypto` docs.',
    );
    console.log(
      '       OR add to BASELINE_VIOLATIONS in this script with a one-line',
    );
    console.log('       priority + reason + remediation direction.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    '\n✓ Rule 12 (crypto randomness): all security-scope files clean.',
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'file with no randomness → none',
      content: `export function foo() { return 42; }`,
      rel: 'foo.ts',
      expected: 'none',
    },
    {
      name: 'security path + non-crypto PRNG call → violation',
      content: `const n = Math.random();`,
      rel: 'auth/session.service.ts',
      expected: 'violation',
    },
    {
      name: 'security path + crypto.randomBytes → none (no PRNG)',
      content: `import { randomBytes } from 'node:crypto'; const n = randomBytes(16);`,
      rel: 'auth/session.service.ts',
      expected: 'none',
    },
    {
      name: 'non-security path + non-crypto PRNG → general',
      content: `const sample = Math.random();`,
      rel: 'alm/monte-carlo.service.ts',
      expected: 'general',
    },
    {
      name: 'PRNG inside a /* */ comment → none',
      content: `export const x = 1; /* see Math.random() docs */`,
      rel: 'auth/session.service.ts',
      expected: 'none',
    },
    {
      name: 'PRNG inside a // line comment → none',
      content: `export const x = 1;\n// uses Math.random() for jitter`,
      rel: 'auth/session.service.ts',
      expected: 'none',
    },
    {
      name: 'file named *.guard.ts outside security prefix → still security scope',
      content: `const n = Math.random();`,
      rel: 'common/some-feature.guard.ts',
      expected: 'violation',
    },
    {
      name: 'file named *.shield.ts → still security scope',
      content: `const n = Math.random();`,
      rel: 'features/anti-injection.shield.ts',
      expected: 'violation',
    },
    {
      name: 'file named *.middleware.ts → still security scope',
      content: `const n = Math.random();`,
      rel: 'common/audit.middleware.ts',
      expected: 'violation',
    },
    {
      name: 'destructured PRNG in security path → violation',
      content: `const { random } = Math; const x = random();`,
      rel: 'auth/session.service.ts',
      expected: 'violation',
    },
    {
      name: 'destructured PRNG in non-security path → general',
      content: `const { random } = Math; const x = random();`,
      rel: 'alm/options.service.ts',
      expected: 'general',
    },
    {
      name: 'JSDoc that documents the PRNG → none (stripComments)',
      content: `/** Uses Math.random() under the hood. */\nexport const x = 42;`,
      rel: 'auth/foo.service.ts',
      expected: 'none',
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
  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
