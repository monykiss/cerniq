/**
 * A11y sweep — runs axe-core against every public route discovered by
 * discover-routes.mjs. Emits per-route and aggregate results JSON to
 * e2e/a11y-sweep/results/ for the report renderer to consume.
 *
 * Modes:
 *   - Default:            fails on new violations that exceed baseline
 *   - A11Y_WRITE_BASELINE=1: writes current violations as the new baseline
 *                            (use when triaging is complete and you want to
 *                            lock in the no-regress contract)
 *
 * To run against production instead of local dev:
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://cerniq.io \
 *     npm run a11y:sweep
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AXE_TAGS,
  DISABLED_RULES,
  FAIL_IMPACTS,
  RATCHET_IMPACTS,
  type AxeViolationSummary,
  type RouteResult,
} from './axe-config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = join(__dirname, 'routes.generated.json');
const RESULTS_DIR = join(__dirname, 'results');
const BASELINE_PATH = join(__dirname, 'baseline.json');
const RATCHET_PATH = join(__dirname, 'ratchet.json');

const WRITE_BASELINE = process.env.A11Y_WRITE_BASELINE === '1';

type RouteEntry = {
  route: string;
  status: 'include' | 'auth' | 'dynamic' | 'skip' | 'skip-dynamic';
  concreteUrl: string | null;
};

function loadRoutes(): RouteEntry[] {
  if (!existsSync(ROUTES_PATH)) {
    throw new Error(
      `routes.generated.json not found — run 'npm run a11y:routes' first`,
    );
  }
  const payload = JSON.parse(readFileSync(ROUTES_PATH, 'utf8'));
  return payload.routes;
}

function loadBaseline(): Record<string, string[]> {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function ensureResultsDir() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
}

const allRoutes = loadRoutes();
const publicRoutes = allRoutes.filter(
  (r) => r.status === 'include' || (r.status === 'dynamic' && r.concreteUrl),
);

const baseline = loadBaseline();
const collected: RouteResult[] = [];

test.describe('a11y sweep (public routes)', () => {
  // One test per route, parametrized. Playwright's fullyParallel runs them
  // concurrently; ~170 routes at ~10s each ÷ 8 workers ≈ 4 min wall time.
  for (const entry of publicRoutes) {
    const urlPath = entry.concreteUrl || entry.route;

    test(`${entry.route}`, async ({ page }) => {
      // Accept cookie consent so banners don't chew the hit area
      await page.addInitScript(() => {
        window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
      });

      const started = Date.now();
      let httpStatus: number | undefined;
      page.on('response', (resp) => {
        if (resp.url().endsWith(urlPath) || resp.url().endsWith(urlPath + '/')) {
          httpStatus = resp.status();
        }
      });

      const response = await page.goto(urlPath, { waitUntil: 'domcontentloaded' });
      httpStatus ??= response?.status();

      // Some pages hydrate async data — give them a beat to settle, but cap it.
      await page
        .waitForLoadState('networkidle', { timeout: 4000 })
        .catch(() => {}); // ignore; we still run axe on whatever rendered

      const builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);
      for (const { id } of DISABLED_RULES) builder.disableRules(id);

      const axe = await builder.analyze();

      const violations: AxeViolationSummary[] = axe.violations.map((v) => ({
        id: v.id,
        impact: (v.impact as AxeViolationSummary['impact']) ?? null,
        help: v.help,
        helpUrl: v.helpUrl,
        nodeCount: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      }));

      const result: RouteResult = {
        route: entry.route,
        url: urlPath,
        loadedOk: (httpStatus ?? 500) < 400,
        httpStatus,
        violations,
        elapsedMs: Date.now() - started,
      };
      collected.push(result);

      if (WRITE_BASELINE) {
        // Write mode — don't assert anything. The afterAll hook saves the file.
        return;
      }

      // Assertion: page must load
      expect(result.loadedOk, `expected HTTP 2xx/3xx, got ${httpStatus}`).toBe(true);

      // Assertion: no NEW critical/serious violations beyond baseline
      const baselineIds = new Set(baseline[entry.route] ?? []);
      const newBlocking = violations.filter(
        (v) =>
          v.impact && FAIL_IMPACTS.includes(v.impact) && !baselineIds.has(v.id),
      );

      if (newBlocking.length > 0) {
        const lines = newBlocking.map(
          (v) =>
            `  · ${v.impact?.toUpperCase()} ${v.id} (${v.nodeCount} node${v.nodeCount === 1 ? '' : 's'}): ${v.help}\n    → ${v.helpUrl}\n    targets: ${v.targets.join(', ')}`,
        );
        throw new Error(
          `New a11y violations on ${entry.route} (exceed baseline):\n${lines.join('\n')}`,
        );
      }
    });
  }
});

test.afterAll(async () => {
  ensureResultsDir();

  const runPath = join(RESULTS_DIR, 'latest.json');
  writeFileSync(
    runPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalRoutes: collected.length,
        totalViolations: collected.reduce((s, r) => s + r.violations.length, 0),
        byImpact: collected
          .flatMap((r) => r.violations)
          .reduce<Record<string, number>>((acc, v) => {
            const k = v.impact ?? 'unknown';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {}),
        results: collected,
      },
      null,
      2,
    ),
  );

  // ─── Ratchet: moderate violations can only decrease ────────────────────
  const ratchetCount = collected
    .flatMap((r) => r.violations)
    .filter((v) => v.impact && RATCHET_IMPACTS.includes(v.impact))
    .reduce((sum, v) => sum + v.nodeCount, 0);

  if (WRITE_BASELINE) {
    const nextBaseline: Record<string, string[]> = {};
    for (const r of collected) {
      const blocking = r.violations
        .filter((v) => v.impact && FAIL_IMPACTS.includes(v.impact))
        .map((v) => v.id);
      if (blocking.length > 0) nextBaseline[r.route] = [...new Set(blocking)].sort();
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(nextBaseline, null, 2));
    writeFileSync(
      RATCHET_PATH,
      JSON.stringify({ updatedAt: new Date().toISOString(), moderateNodeCount: ratchetCount }, null, 2),
    );
    console.log(
      `✔ Wrote new baseline: ${Object.keys(nextBaseline).length} routes with blocking violations` +
        `\n✔ Wrote ratchet: moderateNodeCount=${ratchetCount}`,
    );
    return;
  }

  if (existsSync(RATCHET_PATH)) {
    const prev = JSON.parse(readFileSync(RATCHET_PATH, 'utf8')) as { moderateNodeCount?: number };
    const allowed = prev.moderateNodeCount ?? 0;
    if (ratchetCount > allowed) {
      // Intentionally synthesize a test failure AFTER all specs so the sweep
      // produces per-route detail first, then fails loudly at the end.
      const overhead = ratchetCount - allowed;
      const msg =
        `\n✘ A11Y RATCHET VIOLATION\n` +
        `   Moderate violation count rose from ${allowed} to ${ratchetCount} (+${overhead}).\n` +
        `   The ratchet enforces that moderate-impact violations can only decrease.\n` +
        `   Either fix the new moderate issues, or (rare) run \`npm run a11y:baseline\` to\n` +
        `   deliberately accept the new level with an accompanying justification in the PR.\n`;
      console.error(msg);
      throw new Error('a11y ratchet violated — see logs');
    } else {
      console.log(`✔ Ratchet ok: ${ratchetCount} ≤ ${allowed} moderate nodes`);
    }
  } else {
    console.log(`ℹ No ratchet.json yet — run \`npm run a11y:baseline\` after first green sweep.`);
  }
});
