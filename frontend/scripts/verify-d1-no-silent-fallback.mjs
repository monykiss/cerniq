#!/usr/bin/env node
// scripts/verify-d1-no-silent-fallback.mjs  (frontend)
//
// Frontend counterpart of backend-node/scripts/verify-d1-no-silent-fallback.mjs.
// Enforces CerniQ Decision D1 ("never silent zeros") on the REGULATORY ALM
// pages — the supervisory artifacts a cooperativa hands an examiner.
//
// WHY REGULATORY-ONLY (the rule is narrower on the frontend than the backend):
//   On the backend, a `getDemo*()` fallback is SILENT — nothing tells the
//   caller the result is fabricated, so the backend gate flags it everywhere
//   in src/alm. On the frontend, `getDemo` flows through `<AlmPage>` /
//   `useAlmEndpoint`, which renders an honest amber "Datos de muestra /
//   Sample data" banner when `source === 'demo'`. So on a QUANT page a
//   `getDemo` preview is a LABELED demo (acceptable UX), not a silent lie.
//
//   The hard D1 line — established by the 2026-06 sweep that DELETED `getDemo`
//   from `/alm/cossec`, `/alm/nev`, and `/alm/board-report` — is sharper and
//   narrower: a REGULATORY / supervisory artifact must never supply `getDemo`
//   AT ALL. You never hand an examiner a "sample" compliance verdict; it must
//   be real, or honestly read "data unavailable" (`data_unavailable` shell +
//   a gaps banner + `—`, never a `0`/phantom value). This gate locks that in.
//
// THE ANTI-PATTERN THIS GATE CATCHES:
//   A regulatory-category page (per lib/alm/registry.ts) that references a
//   `getDemo*` identifier in CODE — either `function getDemo()` or a
//   `<AlmPage getDemo={...}>` / `useAlmEndpoint({ getDemo })` callsite.
//   Comments are stripped first, so a D1 tombstone docstring ("No `getDemo`
//   fallback is supplied — a regulatory artifact must never fabricate.") does
//   NOT match. cossec/nev/board-report carry exactly that comment and are
//   therefore CLEAN — if any of them reintroduces a live getDemo, this gate
//   blocks it at CI.
//
// HONEST SCOPE (this gate is not magic — D1 demands we say so):
//   • It catches the `getDemo*` naming anti-pattern on regulatory pages only.
//   • It does NOT police quant/analytical pages (their labeled demo preview is
//     an accepted, non-silent UX — see <AlmPage> source==='demo' banner), nor
//     arbitrary inline fabrication that is not named getDemo*.
//   • The scope set is DERIVED from the registry (category: 'regulatory'), so
//     a new regulatory module is covered automatically the moment it lands.
//
// Exit codes:
//   0 — every regulatory page is clean or baselined; no stale baseline entries
//   1 — a new (unbaselined) getDemo* appeared on a regulatory page, or a
//       baseline entry is stale (the page was swept — remove it + take credit)
//
// Skip the script entirely with VERIFY_D1_SKIP=1 (emergency escape).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'lib', 'alm', 'registry.ts');

// ─── Pattern ───────────────────────────────────────────────────────────
// Matches a `getDemo<Suffix>` identifier (declaration or callsite) in code.
// Comments are stripped before this runs, so a D1-tombstone comment that
// merely names the former helper does NOT match.
const FABRICATION_IDENT = /\bgetDemo[A-Za-z0-9_]*\b/g;

const PAGE_KEY_RE = /^app\/alm\/[a-z0-9-]+\/page\.tsx$/;

function stripComments(content) {
  let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return stripped;
}

// ─── Baseline (chip-away ledger) ─────────────────────────────────────────
// Each key is a regulatory page that still fabricates on empty input via
// `getDemo`. The D1 fix is to DELETE getDemo and render the honest
// data_unavailable shell — see app/alm/cossec/page.tsx, app/alm/nev/page.tsx,
// and app/alm/board-report/page.tsx (the three already-swept wins this gate
// now guards). When a page is fixed, REMOVE its entry — the stale-baseline
// detector will confirm the getDemo is gone and fail until you take the credit.
//
// Locked 2026-06-07 at 7 TODO; chipped 2026-06-08: alerts / form-5300 / rbc2
// swept (getDemo dropped — see each page's D1 tombstone) → 4 TODO remain. The
// 4 left each need BACKEND work before the frontend can render honestly (the
// backend either fabricates synthetic data with no data_unavailable shell, or
// returns a shape the page was never wired to, or has no endpoint) — they are
// NOT a frontend-only drop. cossec / nev / board-report are CLEAN (not listed)
// and therefore protected against regression. 0 unbaselined violations.
const BASELINE = {
  'app/alm/exam-prep/page.tsx':
    'TODO D1 — <AlmPage getDemo={getDemo}>: a COSSEC/NCUA exam-readiness + CAMEL score must never render a sample. BLOCKED: registry has NO endpoint and no backend GET returns ExamPrepData — needs a backend endpoint before getDemo can be dropped.',
  'app/alm/irr-policy/page.tsx':
    'TODO D1 — getDemo fabricates EVE/NII/DurationGap limit status (WATCH/WARNING/BREACH). BLOCKED: irr-policy.service fabricates synthetic safe defaults on an empty balance sheet with NO data_unavailable shell — needs a backend shell first.',
  'app/alm/camel-forecast/page.tsx':
    'TODO D1 — getDemo fabricates the AR(2) 4-quarter CAMEL component prediction. BLOCKED: camel-forecaster.service (src/ai/camel) synthesizes a forecast on no board reports with NO data_unavailable shell — needs a backend shell first.',
  'app/alm/compliance/page.tsx':
    'TODO D1 — getDemoData fabricates the cross-regulator compliance status calendar. BLOCKED: compliance-calendar.service returns a different shape ({events} not {deadlines}, no institutionName/requiredDocuments) and no data_unavailable shell — needs a backend alignment first.',
};

// ─── Registry-derived scope ──────────────────────────────────────────────
// Regulatory pages are the D1 hard-line. Parse the canonical registry (one
// module entry per line) and collect every slug whose category is regulatory.
export function regulatorySlugs(registrySrc) {
  const slugs = [];
  for (const line of registrySrc.split('\n')) {
    if (line.includes("category: 'regulatory'")) {
      const m = line.match(/slug:\s*'([a-z0-9-]+)'/);
      if (m) slugs.push(m[1]);
    }
  }
  return slugs;
}

// ─── Classifier ────────────────────────────────────────────────────────
//   { status: 'none' }                          — out of scope or clean
//   { status: 'baselined', reason, kind, hits } — known offender / allow
//   { status: 'violation', hits }               — NEW fabrication (BLOCKING)
export function classify(content, isRegulatory, relPath) {
  if (!isRegulatory) return { status: 'none' };

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
    console.log('verify-d1-no-silent-fallback (frontend): skipped (VERIFY_D1_SKIP=1)');
    process.exit(0);
  }

  if (!existsSync(REGISTRY_PATH)) {
    console.error(
      `verify-d1-no-silent-fallback (frontend): registry not found at ${REGISTRY_PATH}`,
    );
    process.exit(1);
  }

  const slugs = regulatorySlugs(readFileSync(REGISTRY_PATH, 'utf-8'));
  let todo = 0;
  let allow = 0;
  let scanned = 0;
  let unbuilt = 0;
  const violations = [];
  const baselineHits = new Set();

  for (const slug of slugs) {
    const rel = `app/alm/${slug}/page.tsx`;
    const full = join(REPO_ROOT, rel);
    if (!existsSync(full)) {
      // Registered for nav but no page built yet (regulatory-deadlines,
      // regulatory-monitor, data-quality). Nothing to fabricate — skip.
      unbuilt++;
      continue;
    }
    scanned++;
    const result = classify(readFileSync(full, 'utf-8'), true, rel);
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
    `verify-d1-no-silent-fallback (frontend): ${slugs.length} regulatory slug(s), ${scanned} page(s) scanned, ${unbuilt} unbuilt`,
  );
  console.log(
    `  ${todo} TODO (still fabricating) · ${allow} ALLOW (labeled) · ${violations.length} new violations`,
  );

  let failed = false;
  if (stale.length > 0) {
    console.log(
      '\n✓→ Stale baseline entries (getDemo gone — remove + take the chip-away credit):',
    );
    for (const k of stale) console.log(`  - ${k}`);
    failed = true;
  }
  if (violations.length > 0) {
    console.log(
      '\n❌ New D1 fabrication path(s) — a getDemo* on a REGULATORY page (BLOCKING):',
    );
    for (const v of violations) {
      console.log(`  - ${v.rel}  [${v.hits.join(', ')}]`);
    }
    console.log(
      '\n  D1 fix: a regulatory/supervisory artifact must never render a sample.',
    );
    console.log(
      '       Remove `getDemo` from <AlmPage>/useAlmEndpoint; on empty input the',
    );
    console.log(
      "       backend returns a `data_unavailable` shape + gaps[] — render `—`,",
    );
    console.log(
      '       a gray semáforo, and <DataGapBanner>. See app/alm/cossec/page.tsx',
    );
    console.log('       and app/alm/nev/page.tsx for the canonical pattern.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log(
    `\n✓ D1 (never silent zeros): no fabrication on regulatory pages. ${todo} page(s) remain on the chip-away ledger; cossec/nev/board-report are swept + guarded.`,
  );
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    {
      name: 'new regulatory page with <AlmPage getDemo={getDemo}> → violation',
      content: `<AlmPage slug="x" getDemo={getDemo}>`,
      isRegulatory: true,
      rel: 'app/alm/brand-new/page.tsx',
      expected: 'violation',
    },
    {
      name: 'regulatory page with getDemo only in a // tombstone comment → none',
      content: `export default function P(){}\n// No \`getDemo\` fallback — a regulatory artifact must never fabricate.`,
      isRegulatory: true,
      rel: 'app/alm/cossec/page.tsx',
      expected: 'none',
    },
    {
      name: 'regulatory page with getDemo only in a /* */ block comment → none',
      content: `/* historical: getDemo removed in the 2026-06 sweep */\nexport const x = 1;`,
      isRegulatory: true,
      rel: 'app/alm/nev/page.tsx',
      expected: 'none',
    },
    {
      name: 'regulatory page with no getDemo at all → none',
      content: `return <DataGapBanner gaps={gaps} />;`,
      isRegulatory: true,
      rel: 'app/alm/board-report/page.tsx',
      expected: 'none',
    },
    {
      name: 'baselined TODO offender → baselined',
      content: `<AlmPage slug="exam-prep" getDemo={getDemo}>`,
      isRegulatory: true,
      rel: 'app/alm/exam-prep/page.tsx',
      expected: 'baselined',
    },
    {
      name: 'getDemo on a NON-regulatory (quant) page → none (out of scope)',
      content: `<AlmPage slug="garch" getDemo={getDemo}>`,
      isRegulatory: false,
      rel: 'app/alm/garch/page.tsx',
      expected: 'none',
    },
    {
      name: 'function getDemo() declaration on a new regulatory page → violation',
      content: `function getDemo(): RbcResult { return { fake: 1 }; }`,
      isRegulatory: true,
      rel: 'app/alm/another-reg/page.tsx',
      expected: 'violation',
    },
    {
      name: 'getDemoData variant on a new regulatory page → violation',
      content: `setData(getDemoData());`,
      isRegulatory: true,
      rel: 'app/alm/yet-another/page.tsx',
      expected: 'violation',
    },
    {
      name: 'comment-stripping does not eat a following code line',
      content: `// getDemo historical note\n<AlmPage getDemo={getDemo}>`,
      isRegulatory: true,
      rel: 'app/alm/mixed/page.tsx',
      expected: 'violation',
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const result = classify(c.content, c.isRegulatory, c.rel);
    if (result.status === c.expected) {
      pass++;
    } else {
      fail++;
      console.log(`✗ ${c.name}`);
      console.log(`  expected: ${c.expected}, got: ${result.status}`);
    }
  }

  // Parity: every baseline key must be an app/alm/<slug>/page.tsx path.
  const malformed = Object.keys(BASELINE).filter((k) => !PAGE_KEY_RE.test(k));
  if (malformed.length === 0) {
    pass++;
  } else {
    fail++;
    console.log(`✗ baseline contains malformed keys: ${malformed.join(', ')}`);
  }

  // Parity: regulatorySlugs() must extract slugs from a registry line.
  const probe = regulatorySlugs(
    `  { slug: 'cossec', category: 'regulatory', endpoint: 'x' },\n  { slug: 'var', category: 'quant' },`,
  );
  if (probe.length === 1 && probe[0] === 'cossec') {
    pass++;
  } else {
    fail++;
    console.log(`✗ regulatorySlugs probe failed: got ${JSON.stringify(probe)}`);
  }

  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
