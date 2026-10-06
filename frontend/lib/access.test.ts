import { describe, expect, it } from 'vitest';
import {
  ACCESS_REQUIRED_ROUTE,
  hasFreeBuilderAccess,
  prefersPortalExperience,
  requiresPaidAccessPath,
  resolveAuthenticatedDestination,
} from './access';

describe('access helpers', () => {
  it('does not grant free-builder access — unpaid users must pay', () => {
    expect(
      hasFreeBuilderAccess({
        platformAccessAllowed: false,
        isPlatformAdmin: false,
        isPaid: false,
        isDemo: false,
        effectiveTier: 'free',
        effectiveStatus: null,
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'subscription_required',
      }),
    ).toBe(false);
  });

  it('keeps past-due users out of the free builder lane', () => {
    expect(
      hasFreeBuilderAccess({
        platformAccessAllowed: false,
        isPlatformAdmin: false,
        isPaid: false,
        isDemo: false,
        effectiveTier: 'monthly',
        effectiveStatus: 'past_due',
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'subscription_past_due',
      }),
    ).toBe(false);
  });

  it('marks app routes as paid-only including onboarding and alm', () => {
    expect(requiresPaidAccessPath('/portal')).toBe(true);
    expect(requiresPaidAccessPath('/dashboard')).toBe(true);
    expect(requiresPaidAccessPath('/onboarding')).toBe(true);
    expect(requiresPaidAccessPath('/alm')).toBe(true);
  });

  it('routes unpaid users to access-required instead of the free builder lane', () => {
    const freeAccess = {
      platformAccessAllowed: false,
      isPlatformAdmin: false,
      isPaid: false,
      isDemo: false,
      effectiveTier: 'free',
      effectiveStatus: null,
      effectivePeriodEnd: null,
      daysRemaining: null,
      reason: 'subscription_required' as const,
    };

    expect(
      resolveAuthenticatedDestination({
        access: freeAccess,
        onboardingComplete: false,
      }),
    ).toBe(ACCESS_REQUIRED_ROUTE);
    expect(
      resolveAuthenticatedDestination({
        access: freeAccess,
        onboardingComplete: true,
      }),
    ).toBe(ACCESS_REQUIRED_ROUTE);
    expect(
      resolveAuthenticatedDestination({
        access: {
          ...freeAccess,
          platformAccessAllowed: true,
          isDemo: true,
          effectiveTier: 'demo',
          effectiveStatus: 'active',
          reason: 'demo_active',
        },
        onboardingComplete: false,
      }),
    ).toBe('/onboarding');
    expect(
      resolveAuthenticatedDestination({
        access: {
          ...freeAccess,
          platformAccessAllowed: true,
          isDemo: true,
          effectiveTier: 'demo',
          effectiveStatus: 'active',
          reason: 'demo_active',
        },
        onboardingComplete: true,
      }),
    ).toBe('/dashboard');
    expect(
      resolveAuthenticatedDestination({
        access: {
          ...freeAccess,
          effectiveTier: 'monthly',
          reason: 'subscription_past_due',
        },
        onboardingComplete: true,
      }),
    ).toBe(ACCESS_REQUIRED_ROUTE);
  });

  it('does not mark a platform admin as portal-preferring', () => {
    expect(
      prefersPortalExperience({
        platformAccessAllowed: true,
        isPlatformAdmin: true,
        isPaid: false,
        isDemo: false,
        effectiveTier: 'free',
        effectiveStatus: null,
        effectivePeriodEnd: null,
        daysRemaining: null,
        reason: 'platform_admin',
      }),
    ).toBe(false);
  });
});
