import { defineConfig, devices } from '@playwright/test';

const frontendBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3101';
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';
const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ||
  process.env.NEXT_PUBLIC_NODE_API_URL ||
  'http://127.0.0.1:3100';
const backendCommand =
  process.env.PLAYWRIGHT_BACKEND_COMMAND ||
  "sh -c 'cd ../backend-node && test -f dist/src/main.js || npm run build >/dev/null; PORT=3100 BACKEND_PORT=3100 npm run start:prod'";
const frontendCommand =
  process.env.PLAYWRIGHT_FRONTEND_COMMAND ||
  "sh -c 'test -f .next/BUILD_ID && test -f .next/prerender-manifest.json || npm run build >/dev/null; ENABLE_ADMIN=1 NEXT_PUBLIC_NODE_API_URL=http://127.0.0.1:3100 NEXT_PUBLIC_API_URL=http://127.0.0.1:3100 npx next start --port 3101'";

process.env.PLAYWRIGHT_BASE_URL ??= frontendBaseUrl;
process.env.PLAYWRIGHT_BACKEND_URL ??= backendBaseUrl;

const webServer = skipWebServer
  ? undefined
  : [
      {
        command: backendCommand,
        url: `${backendBaseUrl}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
      },
      {
        command: frontendCommand,
        url: frontendBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
      },
    ];

// Opt-in globalSetup for the a11y-authed sweep. We don't want the regular
// E2E suite paying the cost of an auth-setup round-trip on every run, so
// this only fires when A11Y_AUTH_SETUP=1 is in the env (the a11y:sweep
// npm script sets it automatically).
//
// Playwright 1.50+ loads .ts configs as ESM, so the prior `require.resolve()`
// pattern threw `ReferenceError: require is not defined in ES module scope`
// and cascaded into every spec file under e2e/. The plain relative-path
// string works in both CJS and ESM loaders — Playwright resolves it itself.
const globalSetup =
  process.env.A11Y_AUTH_SETUP === '1'
    ? './e2e/a11y-sweep/global-setup.ts'
    : undefined;

// The a11y-sweep specs depend on A11Y_AUTH_SETUP-gated globalSetup and the
// `npm run a11y:sweep` env scaffolding (separate `.github/workflows/a11y-sweep.yml`).
// Excluding them from the regular E2E run keeps Frontend E2E Tests focused on
// the production-critical, public-footer-links, and legal-pages suites it
// was always meant to cover. When A11Y_AUTH_SETUP=1 (the dedicated workflow),
// testIgnore is undefined and the a11y specs run.
const testIgnore =
  process.env.A11Y_AUTH_SETUP === '1' ? undefined : ['**/a11y-sweep/**'];

export default defineConfig({
  testDir: './e2e',
  testIgnore,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  globalSetup,
  use: {
    baseURL: frontendBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer,
});
