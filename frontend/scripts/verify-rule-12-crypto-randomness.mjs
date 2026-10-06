#!/usr/bin/env node
// scripts/verify-rule-12-crypto-randomness.mjs
//
// KLYTICS Audit Discipline Rule 12 — cryptographic randomness in
// security paths — frontend mirror.
//
// Companion to backend-node/scripts/verify-rule-12-crypto-randomness.mjs
// (commit 20a3cca2). That script scans backend-node/src; this one scans
// frontend/{app,components,hooks,lib} which the backend script doesn't
// reach.
//
// Rule of thumb (frontend variant):
//   In security-scope files — auth pages, API routes that handle auth
//   or credentials, admin surfaces, billing/payment paths, anything
//   issuing tokens or generating IDs that influence access — randomness
//   MUST come from the Web Crypto API:
//     crypto.getRandomValues(buf)  — fill a typed array
//     crypto.randomUUID()          — for v4 UUIDs (HTTPS only)
//
//   In non-security paths (mock chart data, UI element IDs, toast keys,
//   synthetic price-shock generators for demos), the non-crypto PRNG is
//   fine and we don't flag it. Those files get a 'general' count, not a
//   violation.
//
// Why the frontend gets its own script:
//   The backend Rule 12 verifier is rooted at backend-node/src. It does
//   not walk the frontend tree. Mirror is needed for symmetric canon
//   coverage. Backend uses node's crypto.randomBytes; frontend uses Web
//   Crypto's getRandomValues — different module surface, same intent.
//
// Exit codes:
//   0 — all security-scope files clean (or baselined)
//   1 — violation found or stale baseline entry
//
// Skip with VERIFY_RULE_12_FRONTEND_SKIP=1 (escape hatch; don't make a habit).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = join(__dirname, '..');
const SCAN_ROOTS = ['app', 'components', 'hooks', 'lib'].map((d) =>
  join(FRONTEND_ROOT, d),
);

// ─── Patterns ──────────────────────────────────────────────────────────
// Same JSDoc-hygiene trick as the backend verifier: never write the
// literal Math.random token in prose, or stripComments + matcher both
// see it. Referred to as "the non-crypto PRNG" elsewhere.
const PRNG_CALL = /\bMath\s*\.\s*random\s*\(/;
const PRNG_DESTRUCTURE = /\bconst\s*\{[^}]*\brandom\b[^}]*\}\s*=\s*Math\b/;

// ─── Security-scope classifier ─────────────────────────────────────────
// Frontend security-scope is broader and more pattern-based than backend
// because Next.js conflates UI and API surface. We mark a relative path
// (relative to FRONTEND_ROOT) as security-scope if ANY segment matches
// one of these tokens.
const SECURITY_SEGMENTS = new Set([
  // Auth flows
  'login',
  'signup',
  'register',
  'logout',
  'auth',
  'forgot-password',
  'reset-password',
  'access-required',
  'verify-email',
  'mfa',
  // Sensitive surfaces
  'admin',
  'billing',
  'payment',
  'checkout',
  'webhook',
  'webhooks',
  'api-keys',
  'tokens',
]);

// Substring tokens — any path containing these as a segment fragment
// (e.g., `auth-callback`, `password-reset`, `csrf-token`) is security-scope.
const SECURITY_SUBSTRINGS = [
  'auth',
  'password',
  'session',
  'csrf',
  'token',
  'secret',
  'apikey',
  'api-key',
  'credential',
];

// File-name suffix patterns intrinsically security-scope.
const SECURITY_FILENAME = /\.(guard|middleware|auth|session)\.tsx?$/;

function isSecurityScope(relPath) {
  // Path-segment match (e.g., `app/login/page.tsx` → 'login' segment matches)
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (SECURITY_SEGMENTS.has(seg)) return true;
    const segLower = seg.toLowerCase();
    for (const sub of SECURITY_SUBSTRINGS) {
      if (segLower.includes(sub)) return true;
    }
  }
  if (SECURITY_FILENAME.test(relPath)) return true;
  return false;
}

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

// ─── Baseline ──────────────────────────────────────────────────────────
// Known security-scope files using the non-crypto PRNG. Each entry MUST
// include a one-line reason + remediation direction. Empty by intent —
// frontend Rule 12 ships zero-baseline (mirror of backend's clean state
// post-prompt-injection.shield fix). Adding an entry should require a
// docs justification.
const BASELINE_VIOLATIONS = {
  // (empty — frontend's 1 prior offender app/login/page.tsx was fixed in
  // the same wave that landed this verifier; see SESSION_HANDOFF §5 entry.)
};

// ─── Walker ────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'coverage',
  'playwright-report',
  'test-results',
  '__tests__',
  'e2e',
  'a11y-sweep',
]);

function walkTs(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.spec.tsx') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ─── Classifier ────────────────────────────────────────────────────────
//   { status: 'none' }                  — no PRNG call detected
//   { status: 'general' }               — PRNG in non-security path; counted but not blocking
//   { status: 'baselined', reason }     — security-scope offender on the allowlist
//   { status: 'violation' }             — security-scope PRNG (BLOCKING)
export function classify(content, relPath) {
  const codeOnly = stripComments(content);
  const hasPRNG = PRNG_CALL.test(codeOnly) || PRNG_DESTRUCTURE.test(codeOnly);
  if (!hasPRNG) return { status: 'none' };

  if (!isSecurityScope(relPath)) return { status: 'general' };

  if (relPath in BASELINE_VIOLATIONS) {
    return { status: 'baselined', reason: BASELINE_VIOLATIONS[relPath] };
  }
  return { status: 'violation' };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_RULE_12_FRONTEND_SKIP === '1') {
    console.log(
      'verify-rule-12-frontend: skipped (VERIFY_RULE_12_FRONTEND_SKIP=1)',
    );
    process.exit(0);
  }

  const files = SCAN_ROOTS.flatMap(walkTs);
  let general = 0;
  let baselined = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = relative(FRONTEND_ROOT, file);
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
    `verify-rule-12-frontend: scanned ${files.length} src files`,
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
      '\n  Fix: replace with `crypto.getRandomValues(new Uint8Array(N))` or',
    );
    console.log(
      '       `crypto.randomUUID()` (HTTPS contexts only). See Web Crypto API docs.',
    );
    console.log(
      '       OR add to BASELINE_VIOLATIONS in this script with a one-line',
    );
    console.log('       priority + reason + remediation direction.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    '\n✓ Rule 12 (crypto randomness, frontend): all security-scope files clean.',
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'no randomness anywhere → none',
      content: `export const x = 42;`,
      rel: 'app/login/page.tsx',
      expected: 'none',
    },
    {
      name: 'login page with non-crypto PRNG → violation',
      content: `const x = Math.random();`,
      rel: 'app/login/page.tsx',
      expected: 'violation',
    },
    {
      name: 'login page with getRandomValues → none',
      content: `const a = new Uint8Array(8); crypto.getRandomValues(a);`,
      rel: 'app/login/page.tsx',
      expected: 'none',
    },
    {
      name: 'admin page with PRNG → violation (admin segment)',
      content: `const x = Math.random();`,
      rel: 'app/admin/dashboard/page.tsx',
      expected: 'violation',
    },
    {
      name: 'billing API route with PRNG → violation',
      content: `const x = Math.random();`,
      rel: 'app/api/billing/checkout/route.ts',
      expected: 'violation',
    },
    {
      name: 'lib/auth.ts with PRNG → violation (filename substring)',
      content: `const x = Math.random();`,
      rel: 'lib/auth.ts',
      expected: 'violation',
    },
    {
      name: 'destructured PRNG in security path → violation',
      content: `const { random } = Math; const x = random();`,
      rel: 'app/login/page.tsx',
      expected: 'violation',
    },
    {
      name: 'mock price chart in market-data page → general',
      content: `const shock = (Math.random() - 0.5) * 0.03;`,
      rel: 'app/market-data/page.tsx',
      expected: 'general',
    },
    {
      name: 'toast UI id generator → general',
      content: `const id = Math.random().toString(36);`,
      rel: 'components/Toast.tsx',
      expected: 'general',
    },
    {
      name: 'mock data in lib/api.ts → general (no security keyword in path)',
      content: `const shock = Math.random();`,
      rel: 'lib/api.ts',
      expected: 'general',
    },
    {
      name: 'PRNG inside /* */ comment in security path → none',
      content: `/* see Math.random() docs */ export const x = 1;`,
      rel: 'app/login/page.tsx',
      expected: 'none',
    },
    {
      name: 'PRNG inside // line comment in security path → none',
      content: `export const x = 1;\n// uses Math.random() for jitter`,
      rel: 'app/login/page.tsx',
      expected: 'none',
    },
    {
      name: 'file under hooks/use-auth-context.ts with PRNG → violation',
      content: `const x = Math.random();`,
      rel: 'hooks/use-auth-context.ts',
      expected: 'violation',
    },
    {
      name: 'session.guard.ts with PRNG → violation (suffix)',
      content: `const x = Math.random();`,
      rel: 'lib/session.guard.ts',
      expected: 'violation',
    },
    {
      name: 'unrelated component with PRNG → general',
      content: `const id = Math.random();`,
      rel: 'components/SomeWidget.tsx',
      expected: 'general',
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
