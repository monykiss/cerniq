import { expect, test } from "@playwright/test";

test.describe("Get started intake flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cerniq_cookie_consent", "accepted");
    });
  });

  test("accepts a new institution intake and resolves into preview + paid upload", async ({
    page,
  }) => {
    await page.route("**/api/demo-request", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "demo-1",
          message: "Demo request received",
        }),
      });
    });

    await page.route("**/api/billing/checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          checkoutUrl: "https://checkout.stripe.com/c/pay/test_preview_session",
        }),
      });
    });

    await page.goto("/get-started");

    await page.getByPlaceholder("Your name").fill("Maria Rivera");
    await page.getByPlaceholder("you@institution.com").fill("maria@example.coop");
    await page.getByPlaceholder("Institution name").fill("Cooperativa Norte");
    await page.getByRole("combobox").selectOption("cooperativa");
    await page.getByPlaceholder("Total assets (optional)").fill("$42,000,000");
    await page.getByRole("button", { name: "Continue to Pilot" }).click();

    await expect(
      page.getByRole("heading", { name: "Institution Profile Captured" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Preview sample output" }),
    ).toHaveAttribute("href", "/demo?preset=cooperativa");
    await expect(
      page.getByRole("button", { name: "Start Pilot — $750" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Already paid? Open workspace" }),
    ).toHaveAttribute("href", "/login?returnUrl=%2Fportal&mode=magic-link");

    await page.getByRole("button", { name: "Start Pilot — $750" }).click();
    await page.waitForURL((url) => url.hostname === "checkout.stripe.com", {
      timeout: 30000,
    });

    expect(new URL(page.url()).hostname).toBe("checkout.stripe.com");
  });
});
