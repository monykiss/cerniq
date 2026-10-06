import { expect, test, type Page } from '@playwright/test';

const backendBaseUrl = (
  process.env.PLAYWRIGHT_BACKEND_URL ||
  process.env.NEXT_PUBLIC_NODE_API_URL ||
  'http://localhost:3000'
)
  .trim()
  .replace(/\/+$/, '');

const runCheckoutSmoke = process.env.PLAYWRIGHT_ENABLE_CHECKOUT_SMOKE === '1';
const useMockCheckout = process.env.PLAYWRIGHT_MOCK_CHECKOUT !== '0';
const mockStripeCheckoutUrl =
  process.env.PLAYWRIGHT_MOCK_STRIPE_CHECKOUT_URL ||
  'https://checkout.stripe.com/c/pay/test_preview_session';

function attachErrorTracker(page: Page) {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    if (page.url().includes('checkout.stripe.com')) {
      return;
    }

    const text = message.text();
    if (/favicon\.ico/i.test(text)) {
      return;
    }
    if (
      /_next\/webpack-hmr/i.test(text) &&
      /ERR_INVALID_HTTP_RESPONSE/i.test(text)
    ) {
      return;
    }

    errors.push(`console: ${text}`);
  });

  page.on('pageerror', (error) => {
    if (page.url().includes('checkout.stripe.com')) {
      return;
    }
    errors.push(`pageerror: ${error.message}`);
  });

  return async () => {
    expect(errors).toEqual([]);
  };
}

async function seedStableBrowserState(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
  });
}

async function expectSettledPath(page: Page, expectedPath: string) {
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
    .toBe(expectedPath);
  await page.waitForTimeout(400);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
}

async function expectNoFatalUi(page: Page) {
  await expect(page.locator('body')).not.toContainText(
    /Unable to load the login page|Something went wrong|Application error/i,
  );
}

async function enablePortalPaywallState(page: Page) {
  await page.route('**/api/auth/profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'portal-test-user',
          email: 'qa@cerniq.io',
          name: 'CERNIQ QA',
        },
      }),
    });
  });

  await page.route('**/api/billing/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          tier: 'free',
          status: 'inactive',
        },
      }),
    });
  });
}

async function enableAuthenticatedPortalWorkspace(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'cerniq_auth_user',
      JSON.stringify({
        id: 'portal-test-user',
        email: 'qa@cerniq.io',
        name: 'CERNIQ QA',
      }),
    );
    window.localStorage.setItem('cerniq_onboarding_portal-test-user', 'true');
  });

  let overviewRequestCount = 0;

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: {
          id: 'portal-test-user',
          email: 'qa@cerniq.io',
          name: 'CERNIQ QA',
          access: {
            platformAccessAllowed: true,
            isPlatformAdmin: false,
            isPaid: true,
            isDemo: false,
            effectiveTier: 'monthly',
            effectiveStatus: 'active',
            effectivePeriodEnd: null,
            daysRemaining: null,
            reason: 'paid',
          },
        },
      }),
    });
  });

  await page.route('**/api/billing/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          tier: 'monthly',
          status: 'active',
        },
      }),
    });
  });

  await page.route('**/api/portal/overview', async (route) => {
    overviewRequestCount += 1;

    const body =
      overviewRequestCount === 1
        ? {
            success: true,
            data: {
              jobs: [],
              latestActionableJob: null,
              workflowState: 'needs_report',
              counts: {
                total: 0,
                awaitingData: 0,
                validationFailed: 0,
                processing: 0,
                complete: 0,
              },
              demoSeat: { isDemo: false, seat: null },
              nextAction: {
                labelEn: 'Open workspace',
                labelEs: 'Abrir portal',
                href: '/portal',
                jobId: null,
                explanationEn:
                  'Your account is active, but no report cycle is currently awaiting data.',
                explanationEs:
                  'Su cuenta esta activa, pero no hay un ciclo de informe esperando datos.',
              },
              validationSummary: null,
            },
          }
        : {
            success: true,
            data: {
              jobs: [
                {
                  id: 'job-created',
                  institutionId: 'inst-created',
                  institutionName: 'Coop Created',
                  status: 'AWAITING_DATA',
                  analysisPeriod: null,
                  previousJobId: null,
                  submittedAt: null,
                  processingStartedAt: null,
                  completedAt: null,
                  createdAt: '2026-04-18T00:00:00.000Z',
                  reportUrl: null,
                  reportUrlEn: null,
                  reportLang: 'es',
                  errorMessage: null,
                  userId: 'portal-test-user',
                  triggeredBy: 'portal_cycle_bootstrap',
                },
              ],
              latestActionableJob: {
                id: 'job-created',
                institutionId: 'inst-created',
                institutionName: 'Coop Created',
                status: 'AWAITING_DATA',
                analysisPeriod: null,
                previousJobId: null,
                submittedAt: null,
                processingStartedAt: null,
                completedAt: null,
                createdAt: '2026-04-18T00:00:00.000Z',
                reportUrl: null,
                reportUrlEn: null,
                reportLang: 'es',
                errorMessage: null,
                userId: 'portal-test-user',
                triggeredBy: 'portal_cycle_bootstrap',
              },
              workflowState: 'needs_upload',
              counts: {
                total: 1,
                awaitingData: 1,
                validationFailed: 0,
                processing: 0,
                complete: 0,
              },
              demoSeat: { isDemo: false, seat: null },
              nextAction: {
                labelEn: 'Upload balance-sheet data',
                labelEs: 'Cargar datos del balance',
                href: '/portal/submit?jobId=job-created',
                jobId: 'job-created',
                explanationEn:
                  'Your report cycle is waiting for the CSV needed to start validation and analysis.',
                explanationEs:
                  'El ciclo de informe esta esperando el CSV para comenzar la validacion y el analisis.',
              },
              validationSummary: null,
            },
          };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/api/portal/jobs/open-cycle', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          jobId: 'job-created',
          institutionId: 'inst-created',
          institutionName: 'Coop Created',
          status: 'AWAITING_DATA',
          nextHref: '/portal/submit?jobId=job-created',
        },
      }),
    });
  });
}

async function mockCheckoutSession(page: Page) {
  await page.route('**/api/billing/checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkoutUrl: mockStripeCheckoutUrl,
      }),
    });
  });
}

test.describe('Production-critical paths', () => {
  test.beforeEach(async ({ page }) => {
    await seedStableBrowserState(page);
  });

  test('homepage loads and stays stable', async ({ page }) => {
    const assertNoErrors = attachErrorTracker(page);

    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expectSettledPath(page, '/');
    await expect(page).toHaveTitle(/CERNIQ/i);
    await expect(page.locator('body')).toContainText(/Cerniq/i);
    await expect(page.locator('.cerniq-dashboard-page').first()).toBeVisible();
    await expect(page.locator('body')).toContainText(
      /Institutional treasury, risk, and portfolio intelligence/i,
    );
    await expect(page.locator('body')).toContainText(
      /Turn the quarterly ALM scramble into an institutional command center/i,
    );
    await expect(
      page.getByRole('button', { name: /View Interactive Demo/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Start Pilot|Comenzar piloto/i }).first(),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /Live Workspace|Current cycle|Q2 ALM/i,
    );
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('homepage primary entry points lead to working product surfaces', async ({
    page,
  }) => {
    const assertNoErrors = attachErrorTracker(page);

    await page.goto('/');
    await expectSettledPath(page, '/');

    await page.getByRole('button', { name: /Start Pilot|Comenzar piloto/i }).first().click();
    await expectSettledPath(page, '/get-started');
    await expect(page.getByRole('heading', { name: /Start Your Pilot/i })).toBeVisible();

    await page.goBack();
    await expectSettledPath(page, '/');

    await page.getByRole('button', { name: /View Interactive Demo/i }).first().click();
    await expectSettledPath(page, '/demo');
    await expect(page.locator('body')).toContainText(/Start Pilot|Comenzar piloto/i);
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('login page loads without redirect loops', async ({ page }) => {
    const assertNoErrors = attachErrorTracker(page);

    const response = await page.goto('/login');
    expect(response?.ok()).toBeTruthy();
    await expectSettledPath(page, '/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: /^Email$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Email secure sign-in link/i }),
    ).toBeVisible();
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('pricing page loads and exposes primary checkout calls to action', async ({ page }) => {
    const assertNoErrors = attachErrorTracker(page);

    const response = await page.goto('/pricing');
    expect(response?.ok()).toBeTruthy();
    await expectSettledPath(page, '/pricing');
    await expect(page.locator('body')).toContainText(/Plans & Pricing|Planes y precios/i);
    await expect(
      page.getByRole('button', {
        name: /Start|Subscribe|Buy Annual|Comenzar|Suscribirse|Comprar anual/i,
      }).first(),
    ).toBeVisible();
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('legacy portal login route redirects into a portal-intent login flow', async ({ page }) => {
    const assertNoErrors = attachErrorTracker(page);

    const response = await page.goto('/portal/login');
    expect(response?.ok()).toBeTruthy();
    await expectSettledPath(page, '/login');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('returnUrl'))
      .toBe('/portal');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('mode'))
      .toBe('magic-link');
    await expect(
      page.getByRole('button', { name: /Email secure sign-in link/i }),
    ).toBeVisible();
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('dashboard hands authenticated users into the portal submit workspace', async ({
    page,
  }) => {
    const assertNoErrors = attachErrorTracker(page);
    await enableAuthenticatedPortalWorkspace(page);

    const response = await page.goto('/dashboard');
    expect(response?.ok()).toBeTruthy();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/portal/submit');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('createCycle'))
      .toBe('1');

    await expect(page.locator('body')).toContainText(/Upload Your Balance-Sheet Data/i);
    await expect(page.locator('body')).toContainText(/Coop Created/i);
    await expect(
      page.getByRole('button', { name: /Submit Data/i }),
    ).toBeVisible();
    await expectNoFatalUi(page);

    await assertNoErrors();
  });

  test('API health responds with a healthy payload', async ({ request }) => {
    const response = await request.get(`${backendBaseUrl}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data.status');
    expect(body).toHaveProperty('data.services.api', 'up');
  });

  test('pricing checkout handoff reaches Stripe @preview-only', async ({ page }) => {
    test.skip(!runCheckoutSmoke, 'Checkout smoke is only enabled in preview gating runs.');

    const assertNoErrors = attachErrorTracker(page);
    if (useMockCheckout) {
      await mockCheckoutSession(page);
    }

    await page.goto('/pricing');
    await expectSettledPath(page, '/pricing');

    await page
      .getByRole('button', {
        name: /Upgrade to Recurring Access|Activar acceso recurrente/i,
      })
      .first()
      .click();
    await page.waitForURL((url) => url.hostname === 'checkout.stripe.com', {
      timeout: 30000,
    });

    expect(new URL(page.url()).hostname).toBe('checkout.stripe.com');
    await assertNoErrors();
  });

  test('portal paywall checkout handoff reaches Stripe @preview-only', async ({ page }) => {
    test.skip(!runCheckoutSmoke, 'Portal paywall smoke is only enabled in preview gating runs.');

    const assertNoErrors = attachErrorTracker(page);
    await enablePortalPaywallState(page);
    if (useMockCheckout) {
      await mockCheckoutSession(page);
    }

    await page.goto('/portal');
    await expectSettledPath(page, '/portal');
    await expect(page.locator('body')).toContainText(/Paid workspace access/i);

    await page.getByRole('button', { name: /Unlock with/i }).first().click();
    await page.waitForURL((url) => url.hostname === 'checkout.stripe.com', {
      timeout: 30000,
    });

    expect(new URL(page.url()).hostname).toBe('checkout.stripe.com');
    await assertNoErrors();
  });
});
