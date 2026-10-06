#!/usr/bin/env node
/**
 * Discover every App Router page under app/ and emit a JSON file
 * the a11y sweep can consume. Runs offline; no Next build required.
 *
 *  - Converts `app/foo/page.tsx` → `/foo`
 *  - Converts `app/page.tsx`      → `/`
 *  - Strips route groups: `app/(marketing)/foo/page.tsx` → `/foo`
 *  - Marks dynamic routes: `app/portal/reports/[id]/page.tsx` → `/portal/reports/[id]`
 *
 * Routes are then annotated with metadata from ROUTE_OVERRIDES
 * (auth requirements, known-good dynamic IDs, skip flags).
 *
 * Output: e2e/a11y-sweep/routes.generated.json
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = join(__dirname, '..', '..');
const APP_DIR = join(FRONTEND_ROOT, 'app');

/**
 * Per-route overrides. When a route needs auth, a known-good dynamic
 * id, or should be skipped, declare it here. Anything not listed goes
 * through defaults (no auth, skip if dynamic).
 *
 * `status`:
 *   - 'include'  (default for static routes) — swept, violations fail CI
 *   - 'skip'     — entirely excluded from the sweep (API routes, embed frames, etc.)
 *   - 'auth'     — swept in a separate authed project, not the public sweep
 *   - 'dynamic'  — dynamic route; use `concreteUrl` to provide a real URL to sweep
 */
const ROUTE_OVERRIDES = {
  // ── API routes never render HTML ──
  '/api/*': { status: 'skip', reason: 'API route, not a page' },

  // ── Embed frames are bare wrappers; tested via their host page ──
  '/demo/embed': { status: 'skip', reason: 'iframe-only; parent page covers' },

  // ── Auth-gated routes go through authed-sweep (separate spec) ──
  '/dashboard': { status: 'auth' },
  '/admin': { status: 'auth' },
  '/admin/*': { status: 'auth' },
  '/settings/*': { status: 'auth' },
  '/portal/settings': { status: 'auth' },
  '/portal/billing': { status: 'auth' },
  '/portal/cpa-dashboard': { status: 'auth' },

  // ── Dynamic routes: give the sweep a real URL ──
  '/portal/reports/[id]': { status: 'dynamic', concreteUrl: '/portal/reports/demo-report-001' },
};

function walk(dir, entries = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, entries);
    } else if (/^page\.(tsx|jsx|js|ts)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

function toRoute(absPath) {
  const rel = relative(APP_DIR, absPath);        // 'portal/reports/[id]/page.tsx'
  const segments = dirname(rel).split('/');      // ['portal', 'reports', '[id]']
  // Strip route-groups (wrapped in parens) and private folders (prefixed '_')
  const cleaned = segments
    .filter((s) => s !== '.' && !s.startsWith('(') && !s.startsWith('_'));
  return '/' + cleaned.join('/');
}

function matchOverride(route) {
  if (ROUTE_OVERRIDES[route]) return ROUTE_OVERRIDES[route];
  for (const pattern of Object.keys(ROUTE_OVERRIDES)) {
    if (pattern.endsWith('/*') && route.startsWith(pattern.slice(0, -2))) {
      return ROUTE_OVERRIDES[pattern];
    }
  }
  return null;
}

const pages = walk(APP_DIR).sort();
const routes = [];
for (const p of pages) {
  const route = toRoute(p);
  const isDynamic = /\[[^\]]+\]/.test(route);
  const override = matchOverride(route);

  let status = override?.status || (isDynamic ? 'dynamic' : 'include');
  // A dynamic route without a concreteUrl cannot be swept
  if (status === 'dynamic' && !override?.concreteUrl) {
    status = 'skip-dynamic';
  }

  routes.push({
    route,
    file: relative(FRONTEND_ROOT, p),
    status,
    concreteUrl: override?.concreteUrl ?? (isDynamic ? null : route),
    reason: override?.reason ?? null,
  });
}

// Deduplicate (route-group folders can produce dupes like `/pricing`)
const seen = new Set();
const deduped = [];
for (const r of routes) {
  const key = r.route + '|' + r.status;
  if (!seen.has(key)) { seen.add(key); deduped.push(r); }
}

const byStatus = deduped.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

const outPath = join(__dirname, 'routes.generated.json');
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), total: deduped.length, byStatus, routes: deduped }, null, 2));

console.log(`✔ Discovered ${deduped.length} routes → ${relative(FRONTEND_ROOT, outPath)}`);
for (const [status, count] of Object.entries(byStatus).sort()) {
  console.log(`  ${status.padEnd(14)} ${count}`);
}
