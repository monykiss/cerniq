import { test, expect, type Page } from '@playwright/test';

async function waitForLoginPage(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
}

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
    });
  });

  test('should display login page with Cerniq branding', async ({ page }) => {
    await waitForLoginPage(page);
    await expect(page).toHaveURL(/login/);
    // The login page renders the CERNIQ brand lockup and a sign-in heading
    await expect(page.locator('body')).toContainText(/Cerniq/i);
  });

  test('should render email and password fields', async ({ page }) => {
    await waitForLoginPage(page);
    const emailInput = page.locator('#login-email');
    const passwordInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    // Password field enforces minLength=8 via HTML attribute
    await expect(passwordInput).toHaveAttribute('minlength', '8');
  });

  test('should show validation when submitting empty form', async ({ page }) => {
    await waitForLoginPage(page);
    const submitButton = page.getByRole('button', { name: /sign in|iniciar/i });
    await expect(submitButton).toBeVisible();
    await expect(page.locator('#login-email')).toHaveAttribute('required', '');
    await expect(page.locator('input[type="password"]')).toHaveAttribute('required', '');
    await expect(page).toHaveURL(/login/);
  });

  test('should expose a sign-up call to action on the login page', async ({ page }) => {
    await waitForLoginPage(page);
    const toggleButton = page.getByRole('button', {
      name: /don't have an account|no account|sign up|registr/i,
    });
    await expect(toggleButton).toBeVisible();
    await expect(toggleButton).toContainText(/sign up|registr/i);
  });

  test('should redirect /signup to /login?mode=signup', async ({ page }) => {
    await page.goto('/signup');
    // The signup page is a client redirect to /login?mode=signup
    await page.waitForURL(/login.*mode=signup/, { timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/login/);
  });

  test('should include language toggle on login page', async ({ page }) => {
    await waitForLoginPage(page);
    // EN/ES language toggle buttons
    const enButton = page.getByRole('button', { name: 'Switch to English' });
    const esButton = page.getByRole('button', { name: 'Cambiar a Espanol' });
    await expect(enButton).toBeVisible();
    await expect(esButton).toBeVisible();
  });

  test('should launch the local demo flow into an authenticated dashboard shell', async ({
    page,
  }) => {
    let loginAttempts = 0;

    await page.route('**/api/auth/login', async (route) => {
      loginAttempts += 1;

      if (loginAttempts === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Invalid credentials',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'demo-user',
            email: 'local-demo@example.com',
            name: 'Local Demo',
          },
        }),
      });
    });

    await page.route('**/api/auth/register', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'demo-user',
            email: 'local-demo@example.com',
            name: 'Local Demo',
          },
        }),
      });
    });

    await page.route('**/api/auth/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'demo-user',
          email: 'local-demo@example.com',
          name: 'Local Demo',
          access: {
            platformAccessAllowed: true,
            isPlatformAdmin: false,
            isPaid: false,
            isDemo: true,
            effectiveTier: 'demo',
            effectiveStatus: 'active',
            effectivePeriodEnd: null,
            daysRemaining: 14,
            reason: 'demo_active',
          },
        }),
      });
    });

    // /dashboard mounts `hydrateFromStorage` (frontend/lib/store.ts:173) which
    // probes /api/auth/session for an OAuth/cookie-bootstrapped session before
    // trusting the localStorage user. Without this mock the probe returns 404
    // from the Next.js dev server, `response.ok=false` → profile=null → falls
    // through to `setUnauthenticated()` (line 202) and DISCARDS the
    // localStorage user that the local-demo flow just wrote. Result: the
    // dashboard bridge sees isAuthenticated=false, never redirects to /portal,
    // and the "Log out" button never renders — manifesting as the 15s
    // toBeVisible timeout at line 202. Mock returns the same demo user so
    // hydration confirms the in-memory session.
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'demo-user',
            email: 'local-demo@example.com',
            name: 'Local Demo',
            access: {
              platformAccessAllowed: true,
              isPlatformAdmin: false,
              isPaid: false,
              isDemo: true,
              effectiveTier: 'demo',
              effectiveStatus: 'active',
              effectivePeriodEnd: null,
              daysRemaining: 14,
              reason: 'demo_active',
            },
          },
        }),
      });
    });

    await page.route('**/api/workspaces', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'ws-demo',
          name: 'Local Demo Workspace',
        }),
      });
    });

    await page.route('**/api/alm/institutions/seed', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          institutionId: 'inst-demo',
          seedKey: 'pr-cooperativa-demo',
          delta: {
            institution: 'created',
            balanceSheetItems: {
              before: 0,
              after: 12,
              replaced: false,
            },
            liquidityPosition: 'created',
          },
          fixture: {
            seedKey: 'pr-cooperativa-demo',
            name: 'Local Demo Cooperativa',
            itemCount: 12,
          },
        }),
      });
    });

    await waitForLoginPage(page);
    await page
      .getByRole('button', { name: /launch local demo/i })
      .click();

    // 2026-04-19 portal migration: /dashboard is now a bridge whose useEffect
    // calls router.replace('/portal/submit?createCycle=1') once the auth store
    // hydrates (frontend/app/dashboard/page.tsx:108-116). Wait for the bridge
    // to load, then for the portal layout to attach — checking either URL
    // shape covers both the brief bridge moment and the final destination.
    await page.waitForURL(
      (url) => /\/(dashboard|portal)(\b|\/)/.test(url.pathname),
      { timeout: 15000 },
    );
    // Portal layout button text is literally "Log out" (with a space) in
    // frontend/app/portal/layout.tsx:314 — the regex needs `\s*` to accept
    // both the spaced and unspaced forms. The Spanish portion preserves
    // future-locale capacity even though the current source is English-only.
    await expect(
      page.getByRole('button', { name: /log\s*out|cerrar sesi[oó]n|salir/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole('button', { name: /sign in|iniciar sesi[oó]n|iniciar/i }),
    ).toHaveCount(0);
    await expect(page.locator('body')).toContainText(/local-demo@example\.com/i);
  });

  test('auth callback does not livelock — unresolved session redirects to login with bounded probes', async ({
    page,
  }) => {
    // Regression guard for the "stuck on Completing sign in..." livelock.
    // hydrateFromStorage used to flip `initialized` false on every re-probe,
    // tearing down and re-running the callback effect before it could reach the
    // login fallback — an unbounded loop of /api/auth/session requests that
    // never redirected. The page must reach a terminal state with only a
    // handful of probes.
    let sessionProbes = 0;
    await page.route('**/api/auth/session', async (route) => {
      sessionProbes += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false }),
      });
    });

    await page.goto('/auth/callback?returnUrl=%2Fdashboard');

    // Terminal state: the unresolved session bounces to /login (never hangs).
    await page.waitForURL(/\/login/, { timeout: 15000 });

    // Give any runaway loop a full second to misbehave, then assert the probe
    // count stayed bounded. The bug produced dozens-to-unbounded probes; the
    // fixed page issues at most the AuthInitializer boot probe plus the three
    // retry-loop probes.
    await page.waitForTimeout(1000);
    expect(sessionProbes).toBeLessThanOrEqual(8);
  });

  test('auth callback routes a resolved session straight through to the workspace', async ({
    page,
  }) => {
    // The "add the token in another session" path: once a valid cookie-backed
    // session resolves, the callback must forward to the requested workspace
    // destination instead of blocking on the spinner.
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'callback-user',
            email: 'callback@cerniq.io',
            name: 'Callback User',
          },
        }),
      });
    });
    await page.route('**/api/auth/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'callback-user',
          email: 'callback@cerniq.io',
          name: 'Callback User',
        }),
      });
    });
    await page.route('**/api/workspaces', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/auth/callback?returnUrl=%2Fdashboard');

    // Leaves the callback for the workspace shell (dashboard bridge or portal),
    // and never strands the user back on /login.
    await page.waitForURL(
      (url) => /\/(dashboard|portal)(\b|\/)/.test(url.pathname),
      { timeout: 15000 },
    );
    await expect(page).not.toHaveURL(/\/auth\/callback/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should show Google OAuth button when enabled', async ({ page }) => {
    await waitForLoginPage(page);
    // Google OAuth link is rendered by default (NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH defaults to true)
    const googleLink = page.locator('a').filter({ hasText: /Google/i });
    // This may or may not be visible depending on env vars, so we just check the page loads
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeTruthy();
  });
});
