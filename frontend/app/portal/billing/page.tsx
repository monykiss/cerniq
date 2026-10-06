'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePortal } from '../layout';
import {
  CreditCard,
  ExternalLink,
  CheckCircle,
  Shield,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { analytics, EVENTS } from '@/lib/analytics';
import { getPublicApiUrl } from '@/lib/api-base';
import { unwrapApiData } from '@/lib/api-response';
import { isActiveDemo } from '@/lib/access';

const TIER_DETAILS: Record<string, { name: string; price: string; features: string[] }> = {
  free: {
    name: 'Free',
    price: '$0',
    features: ['Demo access', 'Public data preview'],
  },
  demo: {
    name: 'Demo Seat',
    price: 'Trial',
    features: [
      'Full ALM report from COSSEC public filings',
      'ALCO board pack (ES + EN)',
      '14-day evaluation window',
      'Upgrade preserves your workspace',
    ],
  },
  one_time: {
    name: 'Single Report',
    price: '$750',
    features: ['One ALM report (ES + EN)', 'Board-ready PDF', 'Share link'],
  },
  monthly: {
    name: 'Pilot (90-day)',
    price: '$2,500/mo',
    features: ['Full ALM platform', 'AI-powered Analyst', 'Cancel anytime', 'Bilingual reports'],
  },
  annual: {
    name: 'Standard (Annual)',
    price: '$3,500/mo',
    features: ['Everything in Pilot', 'Unlimited users', 'Priority support', 'HJM Monte Carlo engine'],
  },
  partner: {
    name: 'Partner / Multi-Client',
    price: '$499/mo',
    features: ['Everything in Annual', 'Multi-client management', 'API access', 'White-label branding'],
  },
};

export default function PortalBilling() {
  const { subscription, access, user } = usePortal();
  const [loadingPortal, setLoadingPortal] = useState(false);

  const tier = subscription?.tier || 'free';
  const details = TIER_DETAILS[tier] || TIER_DETAILS.free;
  const isDemo = isActiveDemo(access) || tier === 'demo';
  const daysRemaining = access?.daysRemaining ?? null;
  // Institution name pre-fill: the demo seat banner path has the institution
  // name available via user.name or the portal's own state — we surface it
  // through the checkout params so the upgrade flow never asks twice.
  const institutionName = user?.name || '';

  const openBillingPortal = async () => {
    setLoadingPortal(true);
    try {
      analytics.track(EVENTS.PORTAL_BILLING_OPENED, { tier });
      const res = await authFetch(getPublicApiUrl('/api/billing/portal'), {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const { portalUrl } = unwrapApiData<{ portalUrl?: string }>(
          await res.json().catch(() => ({})),
        );
        if (!portalUrl) {
          throw new Error('Billing portal URL missing');
        }
        window.location.href = portalUrl;
      }
    } catch { /* silent */ }
    setLoadingPortal(false);
  };

  return (
    <div className="space-y-6">
      <section className="cerniq-shell p-6 sm:p-8">
        <div className="cerniq-data-wave" />
        <div className="relative z-10">
          <span className="cerniq-kicker mb-5">Billing</span>
          <h1 className="font-display text-3xl text-slate-950 sm:text-5xl">Manage your CERNIQ subscription.</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">Review the current plan, payment state, and secure billing actions without leaving the portal.</p>
        </div>
      </section>

      {/* ─── Demo seat upgrade banner ─── */}
      {isDemo && (
        <section
          aria-labelledby="demo-upgrade-headline"
          className="relative overflow-hidden rounded-3xl border border-amber-300/40 bg-gradient-to-br from-[#1a0e2e] via-[#1B3A6B] to-[#0e2340] p-7 shadow-[0_24px_70px_rgba(232,160,32,0.2)]"
        >
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-fuchsia-400/10 blur-3xl" />

          <div className="relative z-10 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">
                <Sparkles className="h-3.5 w-3.5" />
                Demo seat
              </div>
              <h2
                id="demo-upgrade-headline"
                className="mt-4 font-display text-3xl font-semibold text-white sm:text-4xl"
              >
                {daysRemaining !== null && daysRemaining <= 1
                  ? 'Your analysis expires today'
                  : daysRemaining !== null
                    ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left — upgrade to keep your analysis`
                    : 'Upgrade to keep your analysis'}
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/70">
                When you upgrade, your existing workspace, institution, and
                report are preserved intact — you don&apos;t re-enter anything.
                The demo seat becomes a full CERNIQ subscription with the
                entire ALM platform unlocked.
              </p>

              <ul className="mt-5 space-y-2 text-sm text-white/80">
                <li className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Existing workspace + institution preserved
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Current demo report remains accessible
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Upload real numbers any time to refine the analysis
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Full platform: Monte Carlo, VaR, IRRBB, CECL, full ALM suite
                </li>
              </ul>
            </div>

            <div className="flex flex-col justify-between gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-cyan-300" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                    Access window
                  </p>
                </div>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {daysRemaining !== null ? `${daysRemaining}d` : '—'}
                </p>
                <p className="mt-1 text-xs text-white/60">remaining on demo</p>
              </div>

              <Link
                href={`/pricing?source=demo_upgrade${institutionName ? `&institution=${encodeURIComponent(institutionName)}` : ''}`}
                onClick={() =>
                  analytics.track(EVENTS.PORTAL_BILLING_OPENED, {
                    tier: 'demo_upgrade',
                  })
                }
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#E8A020] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/30 transition hover:bg-[#d19218]"
              >
                Upgrade now
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-center text-[11px] text-white/50">
                Starts at $2,500/mo — cancel any time
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Current Plan */}
      <div className="cerniq-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current Plan</h2>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
            subscription?.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
            subscription?.status === 'past_due' ? 'bg-amber-100 text-amber-700' :
            'bg-slate-100 text-slate-600'
          }`}>
            {subscription?.status || 'active'}
          </span>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50">
            <CreditCard className="h-6 w-6 text-cyan-700" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">{details.name}</p>
            <p className="text-sm text-slate-500">{details.price}</p>
          </div>
        </div>

        <ul className="space-y-2 mb-4">
          {details.features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-slate-600">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              {f}
            </li>
          ))}
        </ul>

        {subscription?.currentPeriodEnd && (
          <p className="text-xs text-slate-400">
            Current period ends: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Manage Subscription (Stripe Portal) */}
      {tier !== 'free' && (
        <div className="cerniq-panel p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Manage Subscription</h2>
          <p className="mb-4 text-sm text-slate-500">
            Update your payment method, view invoices, or change your plan through our secure billing portal.
          </p>
          <button
            onClick={openBillingPortal}
            disabled={loadingPortal}
            className="cerniq-button-primary px-4 py-2.5 text-sm disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            {loadingPortal ? 'Opening...' : 'Open Billing Portal'}
          </button>
        </div>
      )}

      {/* Security Note */}
      <div className="flex items-start gap-3 text-xs text-slate-500">
        <Shield className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Payments are processed securely by Stripe. We never store your card details.</p>
      </div>
    </div>
  );
}
