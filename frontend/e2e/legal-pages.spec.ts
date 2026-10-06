import { test, expect } from '@playwright/test';

test.describe('Legal & Marketing Pages', () => {
  test('should load /terms with bilingual content', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Terms.*CERNIQ/i);
    await expect(page.locator('body')).toContainText('KLYTICS LLC');
    // Should have language toggle
    const enButton = page.getByRole('button', { name: /English/i });
    await expect(enButton).toBeVisible();
  });

  test('should load /privacy with data protection content', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Privacy.*CERNIQ/i);
    await expect(page.locator('body')).toContainText(/AES-256|encryption/i);
  });

  test('should load /security with security controls', async ({ page }) => {
    const response = await page.goto('/security');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Security.*CERNIQ/i);
    await expect(page.locator('body')).toContainText(/Encryption|Access Control/i);
  });

  test('should load /contact with demo booking form', async ({ page }) => {
    const response = await page.goto('/contact');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/Contact.*CERNIQ/i);
    // Form should have required fields
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('should load /why-cerniq', async ({ page }) => {
    const response = await page.goto('/why-cerniq');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toContainText(/CERNIQ/i);
  });

  test('should load /compliance with regulatory matrix', async ({ page }) => {
    const response = await page.goto('/compliance');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toContainText(/Public Compliance Matrix|Matriz Publica de Cumplimiento/i);
    await expect(page.locator('body')).toContainText(/COSSEC|NCUA|Basel IRRBB|CECL/i);
    await expect(page.locator('body')).toContainText(/capability map|mapa de capacidades/i);
  });

  test('should load /roi calculator', async ({ page }) => {
    const response = await page.goto('/roi');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load /changelog', async ({ page }) => {
    const response = await page.goto('/changelog');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load /developers with API docs', async ({ page }) => {
    const response = await page.goto('/developers');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toContainText(/API/i);
  });

  test('legal pages should have back link to home', async ({ page }) => {
    for (const path of ['/terms', '/privacy', '/security']) {
      await page.goto(path);
      const backLink = page.getByRole('link').filter({ has: page.locator('svg') }).first();
      await expect(backLink).toBeVisible();
    }
  });

  test('should not leak secrets in any marketing page', async ({ page }) => {
    for (const path of ['/terms', '/privacy', '/security', '/contact', '/pricing']) {
      await page.goto(path);
      const content = await page.content();
      expect(content).not.toMatch(/sk_live_|pk_live_|Bearer\s+ey|postgresql:\/\//);
    }
  });
});
