/**
 * Analytics wrapper — Segment as the data layer, routing to GA4 + PostHog.
 * Gracefully degrades when Segment is not loaded (env var not set).
 */

declare global {
  interface Window {
    analytics?: {
      identify: (userId: string, traits?: Record<string, unknown>) => void;
      track: (event: string, properties?: Record<string, unknown>) => void;
      page: (name?: string, properties?: Record<string, unknown>) => void;
      reset: () => void;
    };
  }
}

export const EVENTS = {
  // Auth
  SIGNUP: 'Signed Up',
  LOGIN: 'Logged In',
  LOGOUT: 'Logged Out',

  // Onboarding
  ONBOARDING_COMPLETED: 'Onboarding Completed',
  ONBOARDING_SKIPPED: 'Onboarding Skipped',

  // Features
  ALM_ANALYSIS_RUN: 'ALM Analysis Run',
  ALM_STRESS_TEST_RUN: 'ALM Stress Test Run',
  ALM_REPORT_DOWNLOADED: 'ALM Report Downloaded',
  INSTITUTION_TYPE_SELECTED: 'Institution Type Selected',
  DEMO_DATA_SEEDED: 'Demo Data Seeded',
  DEMO_STARTED: 'Demo Started',
  DEMO_SEED_COMPLETE: 'Demo Seed Complete',
  DEMO_CALC_COMPLETE: 'Demo Calc Complete',
  DEMO_PDF_DOWNLOADED: 'Demo PDF Downloaded',
  DEMO_LEAD_FORM_OPENED: 'Demo Lead Form Opened',
  DEMO_COMPLETED: 'Demo Completed',
  TICKER_SEARCHED: 'Ticker Searched',
  PORTFOLIO_CREATED: 'Portfolio Created',
  VALUATION_VIEWED: 'Valuation Viewed',
  RISK_ANALYSIS_RUN: 'Risk Analysis Run',

  // SaaS Funnel (SAAS-10)
  CHECKOUT_STARTED: 'Checkout Started',
  CHECKOUT_COMPLETED: 'Checkout Completed',
  PORTAL_LOGIN_REQUESTED: 'Portal Login Requested',
  PORTAL_LOGGED_IN: 'Portal Logged In',
  PORTAL_DATA_SUBMITTED: 'Portal Data Submitted',
  PORTAL_DATA_VALIDATION_FAILED: 'Portal Data Validation Failed',
  PORTAL_REPORT_VIEWED: 'Portal Report Viewed',
  PORTAL_REPORT_DOWNLOADED: 'Portal Report Downloaded',
  PORTAL_BILLING_OPENED: 'Portal Billing Opened',
  PORTAL_SETTINGS_SAVED: 'Portal Settings Saved',
  UPGRADE_PROMPT_SHOWN: 'Upgrade Prompt Shown',
  UPGRADE_PROMPT_CLICKED: 'Upgrade Prompt Clicked',
  MAGIC_LINK_CLICKED: 'Magic Link Clicked',
  MAGIC_LINK_EXPIRED: 'Magic Link Expired',
  LEAD_FORM_SUBMITTED: 'Lead Form Submitted',
  CSV_TEMPLATE_DOWNLOADED: 'CSV Template Downloaded',
  REPORT_LANGUAGE_TOGGLED: 'Report Language Toggled',
} as const;

function getSegment() {
  if (typeof window !== 'undefined') {
    return window.analytics;
  }
  return undefined;
}

export const analytics = {
  identify(userId: string, traits?: Record<string, unknown>) {
    getSegment()?.identify(userId, traits);
  },

  track(event: string, properties?: Record<string, unknown>) {
    getSegment()?.track(event, properties);
  },

  page(name?: string, properties?: Record<string, unknown>) {
    getSegment()?.page(name, properties);
  },

  reset() {
    getSegment()?.reset();
  },
};
