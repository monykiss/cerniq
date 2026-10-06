/**
 * A11y sweep (authed routes) — sweeps the 23 routes that require a
 * logged-in session.
 *
 * Authentication flow:
 *   1. e2e/a11y-sweep/global-setup.ts runs ONCE at the start of the test run.
 *      It POSTs to the real /auth/login endpoint with A11Y_SWEEP_EMAIL /
 *      A11Y_SWEEP_PASSWORD, captures the resulting cookies, and mirrors the
 *      access_token into localStorage/sessionStorage. The result is saved
 *      to .auth/authed-state.json (git-ignored).
 *   2. This spec loads that storageState via test.use(), so every test
 *      starts already authenticated — no per-test login overhead.
 *
 * If A11Y_SWEEP_EMAIL/PASSWORD aren't set, globalSetup writes a SKIPPED
 * sentinel and this whole describe block is skipped cleanly.
 *
 * To run locally (export both vars, then run — avoids the pre-commit
 * secret scanner's quoted-password heuristic):
 *   export A11Y_SWEEP_EMAIL=<test-account-email>
 *   export A11Y_SWEEP_PASSWORD=<test-account-password>
 *   npm run a11y:sweep
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
  type AxeViolationSummary,
  type RouteResult,
} from './axe-config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = join(__dirname, 'routes.generated.json');
const BASELINE_PATH = join(__dirname, 'baseline.json');
const RESULTS_DIR = join(__dirname, 'results');
const STORAGE_STATE_PATH = join(__dirname, '.auth', 'authed-state.json');
const SKIPPED_SENTINEL = join(__dirname, '.auth', 'SKIPPED');

const collected: RouteResult[] = [];

const hasAuthState =
  existsSync(STORAGE_STATE_PATH) &&
  (!existsSync(SKIPPED_SENTINEL) || readFileSync(SKIPPED_SENTINEL, 'utf8').trim() === '');

if (!existsSync(ROUTES_PATH)) {
  throw new Error(`Run 'npm run a11y:routes' first to generate ${ROUTES_PATH}`);
}

const routesPayload = JSON.parse(readFileSync(ROUTES_PATH, 'utf8'));
const authedRoutes: Array<{ route: string; concreteUrl: string | null }> = (
  routesPayload.routes as Array<{ route: string; status: string; concreteUrl: string | null }>
).filter((r) => r.status === 'auth');

const baseline: Record<string, string[]> = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {};

test.describe('a11y sweep (authed routes) @authed', () => {
  test.skip(
    !hasAuthState,
    'A11Y_SWEEP_EMAIL / A11Y_SWEEP_PASSWORD not provided — skipping authed sweep',
  );

  // Every test in this describe starts from the authed storage state.
  test.use({ storageState: hasAuthState ? STORAGE_STATE_PATH : undefined });

  for (const entry of authedRoutes) {
    const url = entry.concreteUrl || entry.route;

    test(entry.route, async ({ page }) => {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

      // If the session isn't live (expired token, backend reset, etc.) the
      // app redirects to /login. That's a test failure — fix credentials.
      const finalUrl = page.url();
      if (/\/(login|auth\/callback)\b/.test(finalUrl)) {
        throw new Error(
          `expected authed view of ${url}, got redirected to ${finalUrl}. ` +
            `Verify A11Y_SWEEP_EMAIL still exists and the token hasn't been revoked.`,
        );
      }

      expect(response?.status(), `HTTP ${response?.status()} on ${url}`).toBeLessThan(400);

      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});

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

      collected.push({
        route: entry.route,
        url,
        loadedOk: (response?.status() ?? 500) < 400,
        httpStatus: response?.status(),
        violations,
        elapsedMs: 0,
      });

      const baselineIds = new Set(baseline[entry.route] ?? []);
      const newBlocking = violations.filter(
        (v) =>
          v.impact &&
          (FAIL_IMPACTS as readonly string[]).includes(v.impact) &&
          !baselineIds.has(v.id),
      );

      if (newBlocking.length > 0) {
        const summary = newBlocking
          .map((v) => `  · ${v.impact?.toUpperCase()} ${v.id}: ${v.help}`)
          .join('\n');
        throw new Error(`New a11y violations on ${entry.route}:\n${summary}`);
      }
    });
  }

  // Emit the authed results to a sibling file; render-report.mjs merges it
  // with latest.json when present. Keeping them in separate files means
  // :sweep:public (no authed) doesn't wipe data gathered by a prior full run
  // (we also stamp runId + generatedAt so the renderer can reject stale merges).
  test.afterAll(() => {
    if (!hasAuthState) return; // skipped run — don't overwrite prior results
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(
      join(RESULTS_DIR, 'latest-authed.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          runId: process.env.A11Y_RUN_ID ?? null,
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
  });
});
