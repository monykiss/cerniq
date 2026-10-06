export type PlatformAccessReason =
  | 'paid'
  | 'demo_active'
  | 'platform_admin'
  | 'owner_recovery_bypass'
  | 'subscription_required'
  | 'subscription_past_due'
  | 'subscription_cancelled'
  | 'demo_expired';

export interface PlatformAccessState {
  platformAccessAllowed: boolean;
  isPlatformAdmin: boolean;
  isPaid: boolean;
  isDemo: boolean;
  effectiveTier: string;
  effectiveStatus: string | null;
  effectivePeriodEnd: string | null;
  daysRemaining: number | null;
  reason: PlatformAccessReason;
}

export const ACCESS_REQUIRED_ROUTE = '/access-required';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizePlatformAccess(
  payload: unknown,
): PlatformAccessState | null {
  const candidate = asRecord(payload);
  if (!candidate) {
    return null;
  }

  if (typeof candidate.platformAccessAllowed !== 'boolean') {
    return null;
  }

  return {
    platformAccessAllowed: candidate.platformAccessAllowed,
    isPlatformAdmin: Boolean(candidate.isPlatformAdmin),
    isPaid: Boolean(candidate.isPaid),
    isDemo: Boolean(candidate.isDemo),
    effectiveTier:
      typeof candidate.effectiveTier === 'string'
        ? candidate.effectiveTier
        : 'free',
    effectiveStatus:
      typeof candidate.effectiveStatus === 'string'
        ? candidate.effectiveStatus
        : null,
    effectivePeriodEnd:
      typeof candidate.effectivePeriodEnd === 'string'
        ? candidate.effectivePeriodEnd
        : null,
    daysRemaining:
      typeof candidate.daysRemaining === 'number'
        ? candidate.daysRemaining
        : null,
    reason:
      typeof candidate.reason === 'string'
        ? (candidate.reason as PlatformAccessReason)
        : 'subscription_required',
  };
}

export function isActiveDemo(
  access: PlatformAccessState | null | undefined,
) {
  return Boolean(access?.isDemo) && Boolean(access?.platformAccessAllowed);
}

export function hasPlatformAccess(
  access: PlatformAccessState | null | undefined,
) {
  return Boolean(access?.platformAccessAllowed);
}

/**
 * Former free-builder lane (unpaid → onboarding/dashboard). Disabled: unpaid
 * users must hit ACCESS_REQUIRED_ROUTE and complete Stripe checkout. Kept as a
 * named helper so call sites stay readable while always returning false.
 */
export function hasFreeBuilderAccess(
  _access: PlatformAccessState | null | undefined,
) {
  return false;
}

export function prefersPortalExperience(
  access: PlatformAccessState | null | undefined,
) {
  return Boolean(access && !access.isPlatformAdmin && access.effectiveTier !== 'free');
}

export function isProtectedAppPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  const prefixes = [
    '/access-required',
    '/dashboard',
    '/onboarding',
    '/portal',
    '/settings',
    '/alm',
  ];

  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function requiresPaidAccessPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  const paidPrefixes = [
    '/dashboard',
    '/onboarding',
    '/portal',
    '/settings',
    '/alm',
  ];

  return paidPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function resolveAuthenticatedDestination(params: {
  access: PlatformAccessState | null | undefined;
  onboardingComplete: boolean;
  portalPreferred?: boolean;
}) {
  const { access, onboardingComplete } = params;

  if (!hasPlatformAccess(access)) {
    return ACCESS_REQUIRED_ROUTE;
  }

  if (!onboardingComplete) {
    return '/onboarding';
  }

  return '/dashboard';
}
