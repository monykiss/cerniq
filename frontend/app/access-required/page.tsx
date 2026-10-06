'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Lock, LogOut, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import {
  ACCESS_REQUIRED_ROUTE,
  hasPlatformAccess,
  resolveAuthenticatedDestination,
} from '@/lib/access';
import { authFetch } from '@/lib/auth-fetch';
import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';
import { createCheckoutSession, type CheckoutTier } from '@/lib/billing';
import { isRememberedPortalUser, rememberPortalUser } from '@/lib/subscription';
import { getPublicApiUrl } from '@/lib/api-base';

const AUTH_SETTLE_GRACE_MS = 1200;

const CHECKOUT_PLANS: Array<{
  tier: CheckoutTier;
  label: string;
  price: string;
  detail: string;
}> = [
  {
    tier: 'monthly',
    label: 'Pilot Access',
    price: '$2,500/mo',
    detail: 'Full platform access. Cancel anytime.',
  },
  {
    tier: 'one_time',
    label: 'Pilot Report',
    price: '$750',
    detail: 'One board-ready ALM report.',
  },
];

function hasStoredAuthHint() {
  if (typeof window === 'undefined') {
    return false;
  }

  return [
    sessionStorage.getItem('cerniq_access_token'),
    sessionStorage.getItem('capex_access_token'),
    localStorage.getItem('cerniq_auth_user'),
    localStorage.getItem('capex_auth_user'),
  ].some(Boolean);
}

function reasonCopy(reason: string | undefined) {
  switch (reason) {
    case 'subscription_past_due':
      return 'Your subscription is past due. Update billing to reopen the platform.';
    case 'subscription_cancelled':
      return 'Your paid plan is no longer active. Reactivate billing to regain access.';
    case 'demo_expired':
      return 'Your CERNIQ demo has expired. Choose a paid plan to keep access.';
    case 'subscription_required':
    default:
      return 'CERNIQ requires a paid plan. Complete checkout below to unlock the platform.';
  }
}

export default function AccessRequiredPage() {
  const router = useRouter();
  const {
    initialized,
    isAuthenticated,
    user,
    access,
    onboardingComplete,
    logout,
  } = useAuthStore();
  const [loadingTier, setLoadingTier] = useState<CheckoutTier | null>(null);
  const [openingBilling, setOpeningBilling] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [allowGuestRedirect, setAllowGuestRedirect] = useState(false);

  useEffect(() => {
    if (!initialized || isAuthenticated) {
      setAllowGuestRedirect(false);
      return;
    }

    if (!hasStoredAuthHint()) {
      setAllowGuestRedirect(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAllowGuestRedirect(true);
    }, AUTH_SETTLE_GRACE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [initialized, isAuthenticated]);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    if (!isAuthenticated) {
      if (allowGuestRedirect) {
        router.replace('/login');
      }
      return;
    }

    // Only leave the pay gate when platform access is actually granted.
    // Do not bounce unpaid users back into the app (that caused the refresh loop).
    if (hasPlatformAccess(access)) {
      router.replace(
        resolveAuthenticatedDestination({
          access,
          onboardingComplete,
          portalPreferred: isRememberedPortalUser(),
        }),
      );
    }
  }, [
    initialized,
    isAuthenticated,
    access,
    onboardingComplete,
    router,
    allowGuestRedirect,
  ]);

  const billingRecoveryAvailable = useMemo(() => {
    return Boolean(
      access?.effectiveTier !== 'free' || access?.effectiveStatus,
    );
  }, [access]);

  const startCheckout = async (tier: CheckoutTier) => {
    if (!user?.email) {
      setBillingError('Sign in again, then retry checkout.');
      return;
    }

    setLoadingTier(tier);
    setBillingError('');

    try {
      const checkoutUrl = await createCheckoutSession({
        tier,
        customerEmail: user.email,
        customerName: user.name || undefined,
        successUrl: buildLoginUrlForReturnUrl('/portal?welcome=1', {
          billingSuccess: true,
          forceMagicLink: true,
        }),
        cancelUrl: ACCESS_REQUIRED_ROUTE,
      });
      window.location.href = checkoutUrl;
    } catch (error) {
      setBillingError(
        error instanceof Error
          ? error.message
          : 'Unable to start checkout right now.',
      );
      setLoadingTier(null);
    }
  };

  const openBillingPortal = async () => {
    setOpeningBilling(true);
    setBillingError('');

    try {
      const res = await authFetch(getPublicApiUrl('/api/billing/portal'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || typeof data.portalUrl !== 'string') {
        throw new Error(
          typeof data?.message === 'string'
            ? data.message
            : 'No billing account was found for this user.',
        );
      }

      rememberPortalUser();
      window.location.href = data.portalUrl;
    } catch (error) {
      setBillingError(
        error instanceof Error
          ? error.message
          : 'Unable to open billing recovery right now.',
      );
    } finally {
      setOpeningBilling(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  if (!initialized || (!isAuthenticated && !allowGuestRedirect)) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center text-[var(--dashboard-text-primary)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
      </div>
    );
  }

  return (
    <div className="cerniq-dashboard-page min-h-screen px-4 py-10 text-[var(--dashboard-text-primary)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="cerniq-dashboard-elevated-surface rounded-[2rem] border p-8 shadow-[0_30px_120px_rgba(113,88,40,0.18)] backdrop-blur-xl sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
            <ShieldAlert className="h-7 w-7" />
          </div>

          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
            Platform Closed
          </p>
          <h1 className="mt-3 font-display text-4xl text-[var(--dashboard-text-primary)] sm:text-5xl">
            Access now requires a paid plan.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--dashboard-text-secondary)] sm:text-base">
            {reasonCopy(access?.reason)}
          </p>

          <div className="mt-8 grid gap-4 rounded-3xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.68)] p-5 sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                Account
              </p>
              <p className="mt-2 text-sm text-[var(--dashboard-text-primary)]">
                {user?.email || 'Unknown user'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                Tier
              </p>
              <p className="mt-2 text-sm capitalize text-[var(--dashboard-text-primary)]">
                {access?.effectiveTier || 'free'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                Status
              </p>
              <p className="mt-2 text-sm capitalize text-[var(--dashboard-text-primary)]">
                {access?.effectiveStatus || 'none'}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {CHECKOUT_PLANS.map((plan) => (
              <button
                key={plan.tier}
                type="button"
                onClick={() => void startCheckout(plan.tier)}
                disabled={loadingTier !== null || !user?.email}
                className="flex flex-col items-start gap-1 rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.82)] px-5 py-4 text-left transition hover:border-[#E8A020]/60 hover:bg-white disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--dashboard-text-primary)]">
                  <Lock className="h-4 w-4 text-[#E8A020]" />
                  {loadingTier === plan.tier
                    ? 'Opening Stripe…'
                    : plan.label}
                </span>
                <span className="text-lg font-semibold text-[#E8A020]">
                  {plan.price}
                </span>
                <span className="text-xs text-[var(--dashboard-text-secondary)]">
                  {plan.detail}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {billingRecoveryAvailable && (
              <button
                type="button"
                onClick={() => void openBillingPortal()}
                disabled={openingBilling || loadingTier !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.82)] px-5 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" />
                {openingBilling ? 'Opening billing...' : 'Recover billing'}
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-transparent px-5 py-3 text-sm font-semibold text-[var(--dashboard-text-secondary)] transition hover:bg-[rgba(247,228,188,0.32)] hover:text-[var(--dashboard-text-primary)]"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>

          {billingError && (
            <p className="mt-4 text-sm text-rose-600">{billingError}</p>
          )}
        </div>

        <p className="px-2 text-center text-xs text-slate-400">
          Checkout opens Stripe directly. Protected app routes stay on{' '}
          {ACCESS_REQUIRED_ROUTE} until payment succeeds.
        </p>
      </div>
    </div>
  );
}
