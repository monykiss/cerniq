#!/usr/bin/env node
/**
 * verify-alm-registry.mjs — CI guard for the ALM module surface.
 *
 * Checks (each exits non-zero on failure):
 *
 *  1. REGISTRY ↔ FILESYSTEM PARITY
 *     Every folder under app/alm/<slug>/ that contains a page.tsx MUST be
 *     registered in lib/alm/registry.ts. Stale registry entries (folder
 *     missing) emit warnings, not errors.
 *
 *  2. TS-NAME LEAK GUARD
 *     No file under app/alm/**\/*.tsx may render a raw object key / slug
 *     as JSX text. Forbidden patterns are listed in LEAK_PATTERNS below.
 *     Rationale: the P0 bug where users saw "nim"/"lambda_0"/"LOANTOSHARE"
 *     must not re-enter the codebase. All KPI labels MUST go through
 *     `label(key, locale)` from @/lib/alm/labels.
 *
 *  3. LABEL DICTIONARY SANITY
 *     Every LABELS entry must have non-empty en AND es strings. Keys that
 *     differ only by case (e.g. 'LCR' vs 'lcr') are a red flag — the
 *     dictionary already does case-insensitive lookup, so duplicates just
 *     invite drift.
 *
 * Flags:
 *   --check  (default)   exits non-zero on any error
 *   --quiet              suppress warnings, only print errors + final line
 *   --self-test          run an internal fixture suite that exercises this
 *                        verifier against known-good and known-bad inputs
 *
 * Wired into `pnpm lint` and standalone as `pnpm verify:alm`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const ALM_DIR = join(ROOT, 'app', 'alm');
const REGISTRY_FILE = join(ROOT, 'lib', 'alm', 'registry.ts');
const LABELS_FILE = join(ROOT, 'lib', 'alm', 'labels.ts');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const SELF_TEST = argv.includes('--self-test');

// ─── Forbidden leak patterns ────────────────────────────────────────────────
//
// Each entry is a regex that identifies an offending line. A few notes:
//  - We scan line-by-line, so multiline JSX expressions are missed; this is
//    acceptable because authors writing multi-line raw-key JSX will usually
//    also have a single-line offender in the vicinity.
//  - The `label(key,` escape hatch on the same line bypasses the check —
//    useful when the author is explicitly calling label() inside a ternary.

const LEAK_PATTERNS = [
  { pattern: />\s*\{key\}\s*</,                             desc: 'raw {key} rendered as JSX text' },
  { pattern: />\s*\{key\.to(?:Upper|Lower)Case\(\)\}/,      desc: 'raw {key.toUpperCase()} rendered as JSX text' },
  { pattern: /font-mono"\s*>\s*\{key\}/,                    desc: 'font-mono styled raw {key}' },
  { pattern: />\s*\{slug\}\s*</,                            desc: 'raw {slug} rendered as JSX text' },
  { pattern: />\s*\{k\}\s*</,                               desc: 'raw {k} rendered as JSX text (single-letter destructure)' },
  { pattern: /\{[a-zA-Z_$][\w$]*\.split\([^)]+\)\.join\([^)]+\)\}/, desc: '{x.split().join()} slug-style humanize fallback' },
  { pattern: /\{[a-zA-Z_$][\w$]*\.replace\(\/-\/g,\s*['"]\s['"]/, desc: "{x.replace(/-/g, ' ')} slug-to-label fallback" },
];

const LEAK_BYPASS = /label\s*\(\s*\w+\s*,/;

// ─── Fixture runner for --self-test ─────────────────────────────────────────

function runSelfTest() {
  const cases = [
    // Forbidden patterns — these should ALL match something in LEAK_PATTERNS
    { src: '<p>{key}</p>',                                expected: 'match', reason: 'raw {key}' },
    { src: '<p>{key.toUpperCase()}</p>',                  expected: 'match', reason: 'upper-case key' },
    { src: '<span className="font-mono">{key}</span>',    expected: 'match', reason: 'font-mono key' },
    { src: '<p>{slug}</p>',                               expected: 'match', reason: 'raw {slug}' },
    { src: '<p>{k}</p>',                                  expected: 'match', reason: 'raw {k}' },
    { src: "<p>{slug.replace(/-/g, ' ')}</p>",            expected: 'match', reason: 'kebab humanize' },

    // Allowed — these should NOT match
    { src: '<p>{label(key, locale)}</p>',                 expected: 'allow', reason: 'label helper' },
    { src: '<p>{label(k, locale)}</p>',                   expected: 'allow', reason: 'label helper w/ short name' },
    { src: '<p>{data.value}</p>',                         expected: 'allow', reason: 'unrelated data access' },
    { src: '<p>{`${value}%`}</p>',                        expected: 'allow', reason: 'template literal' },
  ];

  const failures = [];
  for (const c of cases) {
    let matched = false;
    for (const { pattern } of LEAK_PATTERNS) {
      if (pattern.test(c.src)) matched = true;
    }
    const bypassed = LEAK_BYPASS.test(c.src);
    const flagged = matched && !bypassed;
    const want = c.expected === 'match';
    if (flagged !== want) {
      failures.push(
        `self-test FAIL: ${c.reason}\n  input:   ${c.src}\n  expected: ${c.expected}\n  got:      ${flagged ? 'match' : 'allow'}`,
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\nverify-alm-registry --self-test: ${failures.length} failure(s)`);
    process.exit(1);
  }

  console.log(`verify-alm-registry --self-test: ${cases.length} case(s) pass`);
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ─── Helpers ────────────────────────────────────────────────────────────────

const errors = [];
const warnings = [];

function listAlmSlugs() {
  const entries = readdirSync(ALM_DIR, { withFileTypes: true });
  const slugs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('(')) continue; // route group
    slugs.push(entry.name);
  }
  return slugs.sort();
}

function hasPageFile(slug) {
  try {
    return statSync(join(ALM_DIR, slug, 'page.tsx')).isFile();
  } catch {
    return false;
  }
}

function extractRegisteredSlugs() {
  const src = readFileSync(REGISTRY_FILE, 'utf8');
  const matches = [...src.matchAll(/slug:\s*'([a-z0-9-]+)'/g)];
  return new Set(matches.map((m) => m[1]));
}

/**
 * Extract [slug, href] pairs from registry entries so the filesystem-parity
 * check handles nested routes. `/alm/agents/alerts` lives at
 * `app/alm/agents/alerts/page.tsx` — slug alone (`agent-alerts`) doesn't
 * resolve to a folder path, so we derive the path from href.
 *
 * The regex captures the `slug: '…'` and `href: '/alm/…'` fields within
 * the same registry entry. Uses non-greedy matching to stay inside one
 * object literal.
 */
function extractSlugHrefPairs() {
  const src = readFileSync(REGISTRY_FILE, 'utf8');
  const pairs = [];
  const re = /slug:\s*'([a-z0-9-]+)'[\s\S]*?href:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    pairs.push({ slug: m[1], href: m[2] });
  }
  return pairs;
}

/**
 * Derive the expected page-file path from an href like `/alm/agents/alerts`:
 *   /alm           → overview (special case)
 *   /alm/<x>       → app/alm/<x>/page.tsx
 *   /alm/<x>/<y>   → app/alm/<x>/<y>/page.tsx   (nested route, e.g. agent-alerts)
 */
function hrefToPageFile(href) {
  if (href === '/alm') return join(ALM_DIR, 'page.tsx');
  const stripped = href.replace(/^\/alm\//, '');
  if (!stripped || stripped === '/alm') return join(ALM_DIR, 'page.tsx');
  return join(ALM_DIR, ...stripped.split('/'), 'page.tsx');
}

function hasPageAtHref(href) {
  try {
    return statSync(hrefToPageFile(href)).isFile();
  } catch {
    return false;
  }
}

function* walkTsx(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsx(full);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      yield full;
    }
  }
}

// ─── Check 1: registry ↔ filesystem parity ──────────────────────────────────

const folderSlugs = listAlmSlugs();
const folderSlugSet = new Set(folderSlugs);
const registeredSlugs = extractRegisteredSlugs();
const slugHrefPairs = extractSlugHrefPairs();
const hrefBySlug = new Map(slugHrefPairs.map((p) => [p.slug, p.href]));

for (const slug of folderSlugs) {
  if (!hasPageFile(slug)) continue;
  if (!registeredSlugs.has(slug)) {
    errors.push(
      `[registry] app/alm/${slug}/page.tsx exists but is not registered in lib/alm/registry.ts. ` +
        `Add an entry to ALM_MODULES.`,
    );
  }
}

// Reverse-parity check. A registered slug is considered "present on disk"
// if EITHER the legacy `app/alm/<slug>/page.tsx` exists (flat convention)
// OR the nested path derived from `href` resolves (e.g. `/alm/agents/alerts`
// → `app/alm/agents/alerts/page.tsx`). This handles nested routes without
// forcing a slug-to-folder-name rename.
for (const slug of registeredSlugs) {
  if (slug === 'overview') continue;
  if (folderSlugSet.has(slug)) continue; // flat convention — ok
  const href = hrefBySlug.get(slug);
  if (href && hasPageAtHref(href)) continue; // nested page exists — ok
  warnings.push(
    `[registry] lib/alm/registry.ts has a stale entry for "${slug}" — no ` +
      `app/alm/${slug}/ folder and no page at ${href ?? '(unknown href)'}.`,
  );
}

// ─── Check 2: TS-name leak guard ────────────────────────────────────────────

for (const file of walkTsx(ALM_DIR)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines (both // and * inside block comments)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (LEAK_BYPASS.test(line)) continue;
    for (const { pattern, desc } of LEAK_PATTERNS) {
      if (!pattern.test(line)) continue;
      const rel = relative(ROOT, file);
      errors.push(
        `[label-leak] ${rel}:${i + 1} — ${desc}\n             "${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}"\n             use \`label(key, locale)\` from @/lib/alm/labels instead.`,
      );
      break; // one error per line is enough
    }
  }
}

// ─── Check 3: label dictionary sanity ───────────────────────────────────────

function checkLabelsDictionary() {
  let src;
  try {
    src = readFileSync(LABELS_FILE, 'utf8');
  } catch {
    warnings.push(`[labels] could not read ${LABELS_FILE}`);
    return;
  }

  // Coarse extraction: find lines like `foo: { en: '...', es: '...' }`
  // This is a lint heuristic, not a parser — but it catches the most
  // common drift issues (empty strings, dupe keys).
  const entryRegex = /^\s*([a-zA-Z_][\w]*):\s*\{\s*en:\s*(['"`])([^'"`]*)\2\s*,\s*es:\s*(['"`])([^'"`]*)\4/gm;
  const seenKeys = new Map();
  let m;
  while ((m = entryRegex.exec(src)) !== null) {
    const key = m[1];
    const en = m[3];
    const es = m[5];
    if (!en || !es) {
      errors.push(`[labels] "${key}" has an empty en or es string.`);
    }
    const lowerKey = key.toLowerCase();
    if (seenKeys.has(lowerKey) && seenKeys.get(lowerKey) !== key) {
      warnings.push(
        `[labels] case-insensitive duplicate: "${key}" and "${seenKeys.get(lowerKey)}" — the dictionary lookup is case-insensitive so one is dead code.`,
      );
    }
    seenKeys.set(lowerKey, key);
  }
}

checkLabelsDictionary();

// ─── Report ──────────────────────────────────────────────────────────────────

const summary =
  `verify-alm-registry: ${folderSlugs.length} folder(s), ${registeredSlugs.size} registered, ` +
  `${errors.length} error(s), ${warnings.length} warning(s).`;

if (!QUIET && warnings.length > 0) {
  for (const w of warnings) console.warn('warn  ' + w);
}

if (errors.length > 0) {
  for (const e of errors) console.error('error ' + e);
  console.error('\n' + summary);
  process.exit(1);
}

console.log(summary);
process.exit(0);
