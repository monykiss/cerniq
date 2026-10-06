/**
 * Playwright global setup for the authed a11y sweep.
 *
 * Logs into the backend via the real /auth/login endpoint once, captures
 * the resulting httpOnly cookies into storageState, and also mirrors the
 * access token into sessionStorage (matches how the frontend behaves
 * after a real login — see frontend/lib/api.ts:ACCESS_TOKEN_KEY).
 *
 * Runs once per `playwright test` invocation. The resulting state file is
 * consumed by a11y-sweep-authed.spec.ts via `test.use({ storageState })`.
 *
 * Credentials come from env:
 *   A11Y_SWEEP_EMAIL      — required; skip auth setup if missing
 *   A11Y_SWEEP_PASSWORD   — required; skip auth setup if missing
 *   PLAYWRIGHT_BACKEND_URL — defaults to http://127.0.0.1:3100
 *   PLAYWRIGHT_BASE_URL    — defaults to http://127.0.0.1:3101 (frontend origin)
 *
 * The file this writes is git-ignored and contains a live access_token,
 * so **never commit** .auth/ — the .gitignore entry lives next to this file.
 */
import { request, chromium, type FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STORAGE_STATE_PATH = join(__dirname, '.auth', 'authed-state.json');
const SENTINEL_SKIPPED = join(__dirname, '.auth', 'SKIPPED');

export default async function globalSetup(_config: FullConfig) {
  const email = process.env.A11Y_SWEEP_EMAIL;
  const password = process.env.A11Y_SWEEP_PASSWORD;
  const backend = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:3100';
  const frontendOrigin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3101';

  mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });

  if (!email || !password) {
    // No creds → write a sentinel so the authed spec can skip tidily,
    // and remove any stale state so we don't quietly reuse expired cookies.
    writeFileSync(SENTINEL_SKIPPED, `no A11Y_SWEEP_EMAIL / A11Y_SWEEP_PASSWORD at ${new Date().toISOString()}\n`);
    if (existsSync(STORAGE_STATE_PATH)) {
      try { writeFileSync(STORAGE_STATE_PATH, '{"cookies":[],"origins":[]}'); } catch {}
    }
    console.log('[a11y-auth-setup] A11Y_SWEEP_EMAIL/PASSWORD not set — authed sweep will skip');
    return;
  }

  // Hit the real login endpoint with an API context; Playwright captures
  // Set-Cookie headers and we can export them as storageState.
  // The NestJS auth controller mounts at `/api/auth` (see auth.controller.ts:49).
  const api = await request.newContext({ baseURL: backend });
  const loginRes = await api.post('/api/auth/login', {
    data: { email, password },
    failOnStatusCode: false,
  });

  if (!loginRes.ok()) {
    const body = await loginRes.text().catch(() => '');
    throw new Error(
      `[a11y-auth-setup] login failed (${loginRes.status()}): ${body.slice(0, 500)}\n` +
        `Backend: ${backend}. Verify A11Y_SWEEP_EMAIL and A11Y_SWEEP_PASSWORD.`,
    );
  }

  // The frontend mirrors the access token into sessionStorage on hydration.
  // For storageState parity, we extract it from Set-Cookie and seed it via a
  // real browser context's addInitScript (Playwright's storageState captures
  // cookies + localStorage, NOT sessionStorage — we inject separately).
  const stateFromApi = await api.storageState();

  // Fish the access_token value out of cookies to know what to seed
  const accessCookie = stateFromApi.cookies.find((c) => c.name === 'access_token');
  if (!accessCookie) {
    throw new Error('[a11y-auth-setup] login succeeded but no access_token cookie set');
  }

  // Spin up a real browser context, apply the cookies, and populate sessionStorage.
  // Playwright's storageState() dump captures localStorage, so we park the token
  // in localStorage for portability; the frontend will read from either.
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: stateFromApi });
  const page = await context.newPage();
  await page.goto(frontendOrigin);
  await page.evaluate((token) => {
    try {
      window.sessionStorage.setItem('cerniq_access_token', token);
      window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
      // Some code paths fall back to localStorage; keep both in sync.
      window.localStorage.setItem('cerniq_access_token', token);
    } catch {}
  }, accessCookie.value);

  const finalState = await context.storageState();
  writeFileSync(STORAGE_STATE_PATH, JSON.stringify(finalState, null, 2));

  await browser.close();
  await api.dispose();

  // Clear the skip sentinel now that we have real creds
  try { writeFileSync(SENTINEL_SKIPPED, ''); } catch {}
  console.log(`[a11y-auth-setup] authed storageState saved for ${email}`);
}
