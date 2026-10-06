'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { CerniqLockup } from '@/components/brand/CerniqLogo';
import { analytics, EVENTS } from '@/lib/analytics';
import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';
import { createCheckoutSession, type CheckoutTier } from '@/lib/billing';
import type { PortalSubscription } from '@/lib/subscription';

interface PortalPaywallProps {
  path: string;
  subscription: PortalSubscription | null;
  user: {
    email: string;
    name?: string;
  };
}

const PLANS: Array<{
  tier: CheckoutTier;
  eyebrow: string;
  name: string;
  price: string;
  cadence: string;
  summary: string;
}> = [
  {
    tier: 'monthly',
    eyebrow: 'Most teams choose this',
    name: 'Pilot Access',
    price: '$2,500',
    cadence: '/month',
    summary: 'Full ALM platform access. 90-day pilot, cancel anytime.',
  },
  {
    tier: 'one_time',
    eyebrow: 'Start smaller',
    name: 'Pilot Report',
    price: '$750',
    cadence: 'one-time',
    summary: 'A single board-ready ALM report to validate the workflow with live institution data.',
  },
];

const PAYWALL_BULLETS = [
  { icon: Upload, label: 'Secure balance-sheet uploads for live institution data' },
  { icon: FileText, label: 'Bilingual PDF delivery built for ALCO, board, and regulator review' },
  { icon: ShieldCheck, label: 'COSSEC-oriented analysis workflow with 24-hour turnaround' },
];

export default function PortalPaywall({ path, subscription, user }: PortalPaywallProps) {
  const [loadingTier, setLoadingTier] = useState<CheckoutTier | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    analytics.track(EVENTS.UPGRADE_PROMPT_SHOWN, {
      location: 'portal_paywall',
      tier: subscription?.tier || 'free',
      path,
    });
  }, [path, subscription?.tier]);

  async function handleCheckout(tier: CheckoutTier) {
    setError('');
    setLoadingTier(tier);

    analytics.track(EVENTS.CHECKOUT_STARTED, {
      tier,
      location: 'portal_paywall',
      path,
    });

    try {
      const checkoutUrl = await createCheckoutSession({
        tier,
        customerEmail: user.email,
        customerName: user.name,
        successUrl: buildLoginUrlForReturnUrl('/portal?welcome=1', {
          billingSuccess: true,
          forceMagicLink: true,
        }),
        cancelUrl: path.startsWith('/portal') ? path : '/portal',
      });

      window.location.href = checkoutUrl;
    } catch {
      setError('No pudimos abrir el checkout seguro. Intente otra vez o revise /pricing.');
    } finally {
      setLoadingTier(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="cerniq-shell overflow-hidden p-3 sm:p-4 lg:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(21rem,0.9fr)]">
          <div className="relative overflow-hidden rounded-[2rem] border border-[rgba(171,190,214,0.46)] bg-[linear-gradient(145deg,rgba(14,28,48,0.96),rgba(31,53,85,0.92)_54%,rgba(188,142,65,0.24)_100%)] p-6 text-white shadow-[0_30px_90px_rgba(19,33,53,0.28)] sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_80%_22%,rgba(236,179,72,0.26),transparent_20%),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:auto,auto,5.4rem_5.4rem,5.4rem_5.4rem]" />
            <div className="absolute -right-16 top-8 h-44 w-44 rounded-full border border-white/14 bg-white/6 blur-2xl" />
            <div className="absolute -left-10 bottom-[-4.5rem] h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(255,211,138,0.48),rgba(255,211,138,0))]" />

            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/76">
                <LockKeyhole className="h-3.5 w-3.5" />
                Paid workspace access
              </span>

              <div className="mt-6">
                <CerniqLockup tagline="Client Workspace" />
              </div>

              <div className="mt-8 space-y-4">
                <h1 className="max-w-xl font-display text-[clamp(2rem,4vw,3.85rem)] leading-[0.94] text-white">
                  Your CERNIQ workspace is ready. Payment unlocks the live reporting floor.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
                  Su cuenta ya existe, pero el espacio de trabajo de produccion se abre cuando activa un plan.
                  In this workspace you can upload balance sheets, receive bilingual PDF reports,
                  and track delivery without leaving CERNIQ.
                </p>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {PAYWALL_BULLETS.map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/7 px-4 py-4 backdrop-blur-[2px]">
                    <Icon className="h-4 w-4 text-[#ffd58c]" />
                    <p className="mt-3 text-sm leading-6 text-white/74">{label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-white/66">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-2">
                  <Sparkles className="h-4 w-4 text-[#ffd58c]" />
                  Signed in as {user.email}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-2">
                  Current tier: {(subscription?.tier || 'free').replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {PLANS.map((plan) => (
              <article key={plan.tier} className="cerniq-panel cerniq-panel-soft p-5 sm:p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9b742f]">
                  {plan.eyebrow}
                </p>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl text-slate-950">{plan.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{plan.summary}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-4xl text-slate-950">{plan.price}</div>
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{plan.cadence}</div>
                  </div>
                </div>

                <button
                  onClick={() => handleCheckout(plan.tier)}
                  disabled={loadingTier !== null}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d39a2b] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(211,154,43,0.28)] transition hover:-translate-y-0.5 hover:bg-[#bb891f] disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingTier === plan.tier ? 'Opening secure checkout...' : `Unlock with ${plan.price}`}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </article>
            ))}

            <div className="rounded-[1.7rem] border border-dashed border-[rgba(156,176,206,0.7)] bg-white/80 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Prefer to compare first?</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review every plan, compare pilot versus recurring access, or share pricing with your board.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/pricing" className="cerniq-button-secondary px-4 py-2.5 text-sm">
                  View pricing
                </Link>
                <a href="mailto:hello@cerniq.io?subject=CERNIQ%20Workspace%20Access" className="inline-flex items-center text-sm font-medium text-[#9b742f] hover:underline">
                  Contact sales
                </a>
              </div>
              {error ? (
                <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-[1.5rem] border border-[rgba(166,188,215,0.45)] bg-white/86 px-5 py-4 text-sm text-slate-600 shadow-[0_16px_30px_rgba(56,85,123,0.08)]">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1f8dff]" />
        Payments are processed securely by Stripe. CERNIQ never stores raw card details in the workspace.
      </div>
    </div>
  );
}
