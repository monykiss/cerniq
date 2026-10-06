import { test, expect } from '@playwright/test';

test.describe('Navigation & Layout', () => {
  test('should load the landing page with CERNIQ title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CERNIQ/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should render landing page content with value proposition', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    // Hero H1 (frontend/app/page.tsx:575) — post-2026-04-22 brand repositioning.
    // Previous copy "Dashboard-native ALM Intelligence" / "From balance sheet to
    // board-ready ALM decisions" was replaced as part of the institutional-OS pivot.
    await expect(body).toContainText(
      /Turn the quarterly ALM scramble into an institutional command center|Convierta la carrera trimestral de ALM en un centro de mando institucional/i,
    );
    // Subhead naming the four target teams (frontend/app/page.tsx:581).
    await expect(body).toContainText(
      /treasury, ALCO, risk, and investment teams|tesoreria, ALCO, riesgo e inversiones/i,
    );
    // CTA labels resolve via `getAcquisitionCopy(lang)` — primary "Start Pilot" /
    // "Comenzar piloto", secondary "View Interactive Demo" / "Ver demo interactivo"
    // (frontend/lib/acquisition-copy.ts:32-34,68-70).
    await expect(
      page.getByRole('button', { name: /Start Pilot|Comenzar piloto/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /View Interactive Demo|Ver demo interactivo/i }).first(),
    ).toBeVisible();
    // Workspace-specific copy still must not leak to the public landing — same
    // invariant as before the repositioning.
    await expect(body).not.toContainText(/Live Workspace|Current cycle|Q2 ALM/i);
  });

  test('should have navigation links on the landing page', async ({ page }) => {
    await page.goto('/');
    // The landing page contains links to login, pricing, or dashboard
    const links = await page.getByRole('link').all();
    expect(links.length).toBeGreaterThan(0);
  });

  test('should navigate to the pricing page', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBeLessThan(500);
    // Pricing page shows tier information
    await expect(page.locator('body')).toContainText(/Pilot Report|Recurring|Enterprise/i);
  });

  test('should navigate to the status page', async ({ page }) => {
    const response = await page.goto('/status');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should render 404 page for non-existent routes', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-xyz');
    // The custom not-found page shows "404" and bilingual Spanish text
    await expect(page.locator('body')).toContainText('404');
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    // Page should not have significant horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10);
  });

  test('should load the demo page', async ({ page }) => {
    const response = await page.goto('/demo');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });
});
