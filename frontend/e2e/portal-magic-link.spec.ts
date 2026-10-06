import { expect, test } from '@playwright/test';

test.describe('Portal magic-link flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
    });
  });

  test('preserves a portal returnUrl through verify and callback without a redirect loop', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'cerniq_auth_user',
        JSON.stringify({
          id: 'portal-user-1',
          email: 'qa@cerniq.io',
        }),
      );
    });

    await page.route('**/api/auth/magic-link/verify**', async (route) => {
      await route.fulfill({
        status: 302,
        headers: {
          location: '/auth/callback?returnUrl=%2Fportal',
        },
        body: '',
      });
    });

    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'portal-user-1',
            email: 'qa@cerniq.io',
            name: 'CERNIQ QA',
            access: {
              platformAccessAllowed: true,
              isPaid: true,
              isDemo: false,
              isPlatformAdmin: false,
              effectiveTier: 'monthly',
              effectiveStatus: 'active',
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: null,
        }),
      });
    });

    const response = await page.goto(
      '/auth/verify?token=test-token&email=qa%40cerniq.io&returnUrl=%2Fportal',
    );

    expect(response?.ok()).toBeTruthy();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
      .toBe('/portal');
    await expect(page.locator('body')).not.toContainText(
      /Unable to load the login page|Something went wrong|Application error/i,
    );
  });
});
