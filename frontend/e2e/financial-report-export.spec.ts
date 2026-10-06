import { expect, test } from "@playwright/test";

test.describe("Financial report export flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cerniq_cookie_consent", "accepted");
      window.localStorage.setItem(
        "cerniq_auth_user",
        JSON.stringify({
          id: "portal-user-1",
          email: "qa@cerniq.io",
          name: "CERNIQ QA",
        }),
      );
      window.localStorage.setItem("cerniq_access_token", "test-token");
      window.localStorage.setItem("cerniq_portal_user", "true");
    });
  });

  test("shows manifest-driven downloads when a portal report is ready", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        const json = (payload: unknown) =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });

        if (url.includes("/api/auth/session")) {
          return json({
            authenticated: true,
            user: {
              id: "portal-user-1",
              email: "qa@cerniq.io",
              name: "CERNIQ QA",
              access: {
                platformAccessAllowed: true,
                isPlatformAdmin: false,
                isPaid: true,
                isDemo: false,
                effectiveTier: "monthly",
                effectiveStatus: "active",
                effectivePeriodEnd: null,
                daysRemaining: null,
                reason: "paid",
              },
            },
          });
        }

        if (url.includes("/api/billing/subscription")) {
          return json({
            success: true,
            data: { tier: "monthly", status: "active" },
          });
        }

        if (url.includes("/api/portal/overview")) {
          return json({
            success: true,
            data: {
              access: {
                platformAccessAllowed: true,
                isPlatformAdmin: false,
                isPaid: true,
                isDemo: false,
                effectiveTier: "monthly",
                effectiveStatus: "active",
                effectivePeriodEnd: null,
                daysRemaining: null,
                reason: "paid",
              },
              jobs: [
                {
                  id: "job-complete",
                  institutionId: "inst-1",
                  institutionName: "Coop Export",
                  status: "COMPLETE",
                  analysisPeriod: "Q1-2026",
                  previousJobId: null,
                  submittedAt: "2026-04-08T10:00:00.000Z",
                  processingStartedAt: "2026-04-08T10:05:00.000Z",
                  completedAt: "2026-04-08T10:10:00.000Z",
                  createdAt: "2026-04-08T09:00:00.000Z",
                  reportUrl: null,
                  reportUrlEn: null,
                  reportLang: "es",
                  errorMessage: null,
                  userId: "portal-user-1",
                  triggeredBy: "portal_submit",
                  exportSummary: {
                    manifestPath: "/api/portal/jobs/job-complete/exports",
                    status: "ready",
                    readyCount: 4,
                    totalCount: 4,
                    readyReportLanguages: ["es", "en"],
                    missingReportLanguages: [],
                    readyBoardPackLanguages: ["es", "en"],
                    missingBoardPackLanguages: [],
                  },
                },
              ],
              latestActionableJob: {
                id: "job-complete",
                institutionId: "inst-1",
                institutionName: "Coop Export",
                status: "COMPLETE",
                analysisPeriod: "Q1-2026",
                previousJobId: null,
                submittedAt: "2026-04-08T10:00:00.000Z",
                processingStartedAt: "2026-04-08T10:05:00.000Z",
                completedAt: "2026-04-08T10:10:00.000Z",
                createdAt: "2026-04-08T09:00:00.000Z",
                reportUrl: null,
                reportUrlEn: null,
                reportLang: "es",
                errorMessage: null,
                userId: "portal-user-1",
                triggeredBy: "portal_submit",
                exportSummary: {
                  manifestPath: "/api/portal/jobs/job-complete/exports",
                  status: "ready",
                  readyCount: 4,
                  totalCount: 4,
                  readyReportLanguages: ["es", "en"],
                  missingReportLanguages: [],
                  readyBoardPackLanguages: ["es", "en"],
                  missingBoardPackLanguages: [],
                },
              },
              workflowState: "report_ready",
              counts: {
                total: 1,
                awaitingData: 0,
                validationFailed: 0,
                processing: 0,
                complete: 1,
              },
              activation: null,
              demoSeat: { isDemo: false, seat: null },
              nextAction: {
                labelEn: "Open latest report",
                labelEs: "Abrir ultimo informe",
                href: "/portal/reports/job-complete",
                jobId: "job-complete",
                explanationEn: "Your report is ready.",
                explanationEs: "Su informe esta listo.",
              },
              validationSummary: null,
            },
          });
        }

        if (url.includes("/api/portal/jobs/job-complete/exports")) {
          return json([
            {
              id: "alm_report:job-complete:es",
              kind: "alm_report",
              language: "es",
              audience: "internal",
              filename: "alm-report-coop-export-es.pdf",
              mimeType: "application/pdf",
              status: "ready",
              downloadUrl: "/api/portal/jobs/job-complete/alm-report?lang=es",
              generatedAt: "2026-04-08T10:10:00.000Z",
              expiresAt: null,
              watermark: null,
              sourceInstitutionId: "inst-1",
              sourceJobId: "job-complete",
            },
            {
              id: "alm_report:job-complete:en",
              kind: "alm_report",
              language: "en",
              audience: "internal",
              filename: "alm-report-coop-export-en.pdf",
              mimeType: "application/pdf",
              status: "ready",
              downloadUrl: "/api/portal/jobs/job-complete/alm-report?lang=en",
              generatedAt: "2026-04-08T10:10:00.000Z",
              expiresAt: null,
              watermark: null,
              sourceInstitutionId: "inst-1",
              sourceJobId: "job-complete",
            },
          ]);
        }

        return originalFetch(input, init);
      };
    });

    await page.goto("/portal");

    // ReportReadyStrip renders "ALM report for <institutionName> is ready"
    // (institutionName is "Coop Export" in the mock above).
    await expect(page.getByText(/ALM report for .* is ready/i)).toBeVisible();
    // Both ReportReadyStrip and ReportSuite render DocumentExportButtons
    // from the same manifest, so each language button appears twice on the
    // page. Using .first() scopes the assertion to the strip (rendered first
    // in the DOM) — validating the download surface exists without depending
    // on render-order being unique.
    await expect(
      page.getByRole("button", { name: /Download report \(ES\)/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Download report \(EN\)/i }).first(),
    ).toBeVisible();
  });
});
