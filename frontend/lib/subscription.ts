export type PortalSubscriptionTier = 'free' | 'demo' | 'one_time' | 'monthly' | 'annual' | 'partner';
export type PortalSubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'grace_period';

export interface PortalSubscription {
  tier: PortalSubscriptionTier | string;
  status: PortalSubscriptionStatus | string;
  currentPeriodEnd?: string;
  reportsUsed?: number;
}

// Demo seats get the same surface as paid plans (no paywall) but are
// time-bounded server-side via tier='demo' + currentPeriodEnd in PlatformAccessService.
const PAID_PORTAL_TIERS = new Set<PortalSubscriptionTier>(['demo', 'one_time', 'monthly', 'annual', 'partner']);
export const PORTAL_USER_STORAGE_KEY = 'cerniq_portal_user';

export function hasPaidPortalAccess(subscription: PortalSubscription | null | undefined) {
  return PAID_PORTAL_TIERS.has((subscription?.tier || 'free') as PortalSubscriptionTier);
}

export function requiresPortalPaywall(subscription: PortalSubscription | null | undefined) {
  return !hasPaidPortalAccess(subscription);
}

export function rememberPortalUser() {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(PORTAL_USER_STORAGE_KEY, 'true');
}

export function isRememberedPortalUser() {
  if (typeof window === 'undefined') {
    return false;
  }
  return localStorage.getItem(PORTAL_USER_STORAGE_KEY) === 'true';
}
