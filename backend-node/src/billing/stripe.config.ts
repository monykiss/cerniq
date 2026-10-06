/**
 * Stripe product/price configuration.
 * Price IDs are set via env vars — create products in Stripe Dashboard first,
 * then copy the price IDs here.
 */
export const STRIPE_PRICE_IDS: Record<string, string> = {
  one_time: process.env.STRIPE_PRICE_ONE_TIME || '',
  monthly: process.env.STRIPE_PRICE_MONTHLY || '',
  annual: process.env.STRIPE_PRICE_ANNUAL || '',
  partner: process.env.STRIPE_PRICE_PARTNER || '',
};

export const STRIPE_PRODUCTS = {
  ONE_TIME_REPORT: {
    name: 'CERNIQ ALM Report',
    description:
      'Full ALM Intelligence Report — bilingual PDF, COSSEC compliance, 5 business days',
    priceAmountCents: 75000,
    mode: 'payment' as const,
    metadata: {
      tier: 'one_time',
      deliverable: 'alm_report_pdf',
      turnaround_days: '5',
    },
  },
  MONTHLY_PLATFORM: {
    name: 'CERNIQ Platform — Monthly',
    description:
      'Unlimited ALM reports, real-time dashboard, monthly compliance alerts',
    priceAmountCents: 29900,
    interval: 'month' as const,
    mode: 'subscription' as const,
    metadata: { tier: 'monthly', reports_per_month: 'unlimited' },
  },
  ANNUAL_PACKAGE: {
    name: 'CERNIQ Annual Compliance Package',
    description:
      '4 quarterly ALM reports + monthly monitoring + board presentation',
    priceAmountCents: 240000,
    interval: 'year' as const,
    mode: 'subscription' as const,
    metadata: {
      tier: 'annual',
      quarterly_reports: '4',
      board_presentation: '1',
    },
  },
  PARTNER_MONTHLY: {
    name: 'CERNIQ Partner Access',
    description:
      'White-label multi-client portal for CPA firms and consultants',
    priceAmountCents: 49900,
    interval: 'month' as const,
    mode: 'subscription' as const,
    metadata: {
      tier: 'partner',
      white_label: 'true',
      max_clients: 'unlimited',
    },
  },
};
