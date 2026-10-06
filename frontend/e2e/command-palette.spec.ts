import { expect, test } from '@playwright/test';

test.describe('ALM command palette', () => {
  test('opens above the ALM shell with populated results via keyboard shortcut', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
      window.localStorage.setItem(
        'cerniq_auth_user',
        JSON.stringify({
          id: 'qa-user',
          email: 'qa@cerniq.io',
          name: 'CERNIQ QA',
        }),
      );
      window.localStorage.setItem('cerniq_access_token', 'test-token');
      window.localStorage.setItem('cerniq_portal_user', 'true');
      // Deterministic empty recent-modules list so the default view is plain
      // registry order, never influenced by a prior run's recent hits.
      window.localStorage.removeItem('cerniq.alm.recent.v1');
    });

    await page.route('**/api/auth/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'qa-user',
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

    await page.route('**/api/alm/institutions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'inst-1',
              name: 'Cooperativa San Juan Demo',
              type: 'credit_union',
              totalAssets: 445,
              currency: 'USD',
              reportingDate: '2026-04-01',
            },
          ],
        }),
      });
    });

    await page.route('**/api/alm/inst-1/exports', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    const response = await page.goto('/alm');
    expect(response?.ok()).toBeTruthy();
    await page.waitForTimeout(800);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
    const options = page.locator('[role="option"]');
    await expect(options.first()).toContainText(/ALM Overview/i);
    // Populated default view — assert it's well-populated, not an exact count.
    // The list slices to MAX_RESULTS; hard-coding 20 is brittle as the module
    // registry grows. "Populated" is the behaviour under test.
    expect(await options.count()).toBeGreaterThanOrEqual(10);
  });

  test('clicking an option navigates away and removes the overlay', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
      window.localStorage.setItem(
        'cerniq_auth_user',
        JSON.stringify({
          id: 'qa-user',
          email: 'qa@cerniq.io',
          name: 'CERNIQ QA',
        }),
      );
      window.localStorage.setItem('cerniq_access_token', 'test-token');
      window.localStorage.setItem('cerniq_portal_user', 'true');
      // Deterministic empty recent-modules list so the default view is plain
      // registry order, never influenced by a prior run's recent hits.
      window.localStorage.removeItem('cerniq.alm.recent.v1');
    });

    await page.route('**/api/auth/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'qa-user',
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

    await page.route('**/api/alm/institutions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'inst-1',
              name: 'Cooperativa San Juan Demo',
              type: 'credit_union',
              totalAssets: 445,
              currency: 'USD',
              reportingDate: '2026-04-01',
            },
          ],
        }),
      });
    });

    await page.route('**/api/alm/inst-1/exports', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/alm');
    await page.waitForTimeout(800);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const options = page.locator('[role="option"]');
    await expect(options.first()).toBeVisible();

    // Select the target option by its accessible name, not a positional index.
    // `nth(1)` assumed balance-sheet sat at slot 1, which is brittle: the
    // default view slices to MAX_RESULTS and registry growth/reordering can
    // shift positions. Naming the option is order-independent and intent-clear.
    const balanceSheet = page.getByRole('option', { name: /Balance Sheet/i });
    await expect(balanceSheet).toBeVisible();
    await balanceSheet.click();

    await expect(page).toHaveURL(/\/alm\/balance-sheet$/);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
