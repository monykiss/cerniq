import { expect, test, type Page } from '@playwright/test';
import { PUBLIC_LEGAL_PATHS, PUBLIC_PATHS } from '../lib/public-links';

const FATAL_PAGE_PATTERN = /404|Page not found|Application error|Something went wrong/i;

async function seedStableBrowserState(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cerniq_cookie_consent', 'accepted');
  });
}

async function expectNoFatalUi(page: Page) {
  await expect(page.locator('body')).not.toContainText(FATAL_PAGE_PATTERN);
}

async function clickFooterLinkAndAssert(page: Page, path: string) {
  await page.goto(PUBLIC_PATHS.home);
  const footer = page.locator('footer').last();
  await footer.scrollIntoViewIfNeeded();

  const link = footer.locator(`a[href="${path}"]`).first();
  await expect(link).toBeVisible();
  await link.click();

  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
    .toBe(path);
  await expectNoFatalUi(page);
}

test.describe('Public footer and legal links', () => {
  test.beforeEach(async ({ page }) => {
    await seedStableBrowserState(page);
  });

  test('homepage footer company and legal links resolve without fatal UI', async ({ page }) => {
    for (const path of [
      PUBLIC_PATHS.compliance,
      PUBLIC_PATHS.contact,
      PUBLIC_PATHS.status,
      ...PUBLIC_LEGAL_PATHS,
    ]) {
      await clickFooterLinkAndAssert(page, path);
    }
  });

  test('homepage compliance link resolves without fatal UI', async ({ page }) => {
    await page.goto(PUBLIC_PATHS.home);

    const complianceLink = page.locator(`a[href="${PUBLIC_PATHS.compliance}"]`).first();
    await expect(complianceLink).toBeVisible();
    await complianceLink.click();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
      .toBe(PUBLIC_PATHS.compliance);
    await expectNoFatalUi(page);
  });

  test('terms and privacy pages keep their contact-page links healthy', async ({ page }) => {
    for (const legalPath of [PUBLIC_PATHS.terms, PUBLIC_PATHS.privacy]) {
      await page.goto(legalPath);
      const contactLink = page.locator(`a[href="${PUBLIC_PATHS.contact}"]`).last();
      await expect(contactLink).toBeVisible();
      await contactLink.click();

      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
        .toBe(PUBLIC_PATHS.contact);
      await expectNoFatalUi(page);
    }
  });
});
