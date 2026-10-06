/**
 * Feature flag system — tier-based access control (SAAS-09)
 */

export type SubscriptionTier = 'free' | 'demo' | 'one_time' | 'monthly' | 'annual' | 'partner';

export type FeatureKey =
  | 'demo'
  | 'reportsPerMonth'
  | 'trendCharts'
  | 'apiAccess'
  | 'whiteLabel'
  | 'alertEmails'
  | 'multiClient'
  | 'boardShareLink'
  | 'boardPresentation';

const FEATURES_BY_TIER: Record<SubscriptionTier, Record<FeatureKey, boolean | number>> = {
  free: {
    demo: true,
    reportsPerMonth: 0,
    trendCharts: false,
    apiAccess: false,
    whiteLabel: false,
    alertEmails: false,
    multiClient: false,
    boardShareLink: false,
    boardPresentation: false,
  },
  // Demo seats: full read-only access to the platform for the duration
  // of the trial. Trend charts on, alerts off, no team invites.
  demo: {
    demo: true,
    reportsPerMonth: 1,
    trendCharts: true,
    apiAccess: false,
    whiteLabel: false,
    alertEmails: false,
    multiClient: false,
    boardShareLink: true,
    boardPresentation: false,
  },
  one_time: {
    demo: true,
    reportsPerMonth: 1,
    trendCharts: false,
    apiAccess: false,
    whiteLabel: false,
    alertEmails: false,
    multiClient: false,
    boardShareLink: true,
    boardPresentation: false,
  },
  monthly: {
    demo: true,
    reportsPerMonth: Infinity,
    trendCharts: true,
    apiAccess: false,
    whiteLabel: false,
    alertEmails: true,
    multiClient: false,
    boardShareLink: true,
    boardPresentation: false,
  },
  annual: {
    demo: true,
    reportsPerMonth: Infinity,
    trendCharts: true,
    apiAccess: false,
    whiteLabel: false,
    alertEmails: true,
    multiClient: false,
    boardShareLink: true,
    boardPresentation: true,
  },
  partner: {
    demo: true,
    reportsPerMonth: Infinity,
    trendCharts: true,
    apiAccess: true,
    whiteLabel: true,
    alertEmails: true,
    multiClient: true,
    boardShareLink: true,
    boardPresentation: true,
  },
};

const UPGRADE_PROMPTS: Partial<Record<FeatureKey, string>> = {
  trendCharts: 'Upgrade to monthly monitoring to track trends across exams.',
  alertEmails: 'Upgrade to receive alerts when ratios approach thresholds.',
  apiAccess: 'Partner tier includes API access for programmatic report generation.',
  multiClient: 'Partner tier includes multi-client management.',
  whiteLabel: 'Partner tier includes white-label branding.',
  boardPresentation: 'Annual package includes a board presentation template.',
};

export function getFeature(tier: SubscriptionTier, feature: FeatureKey): { enabled: boolean; upgradePrompt: string | null } {
  const value = FEATURES_BY_TIER[tier]?.[feature] ?? false;
  const enabled = typeof value === 'number' ? value > 0 : Boolean(value);
  return {
    enabled,
    upgradePrompt: enabled ? null : (UPGRADE_PROMPTS[feature] ?? 'Upgrade to unlock this feature.'),
  };
}

export function useFeature(tier: SubscriptionTier | undefined, feature: FeatureKey) {
  return getFeature(tier || 'free', feature);
}
