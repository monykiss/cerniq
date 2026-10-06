// ─── Pricing Constants — Single Source of Truth ─────────────────
//
// Every surface (pricing page, homepage, get-started, docs) reads
// from this file. Change a number here → updates everywhere.
//
// Stripe price IDs are driven by environment variables so the same
// code works in dev (Stripe test mode) and production (live mode).
//
// Bible-mandated tiers (Vol1 §1.3):
//   Setup: $750 one-time — onboarding & data migration
//   Pilot: $2,500/month — full ALM intelligence, 90-day pilot
//   Standard: $3,500/month — annual contract, unlimited users
//   Partner: $499/month — CPA white-label (additive, not in Bible)

import type { CheckoutTier } from './billing';
import { getAcquisitionCopy } from './acquisition-copy';

export interface PricingTier {
  id: CheckoutTier;
  amount: number;
  label: string;
  labelEs: string;
  cadence: string;
  cadenceEs: string;
  description: string;
  descriptionEs: string;
  stripePriceId: string;
  featured: boolean;
  bullets: Array<{ en: string; es: string }>;
}

export const PRICING: Record<string, PricingTier> = {
  SETUP: {
    id: 'one_time',
    amount: 750,
    label: '$750',
    labelEs: '$750',
    cadence: 'one-time',
    cadenceEs: 'unico',
    description: 'Pilot report',
    descriptionEs: 'Informe piloto',
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_SETUP_PRICE_ID ?? '',
    featured: false,
    bullets: [
      { en: 'One 14+ page bilingual ALM report', es: 'Un informe ALM bilingue de 14+ paginas' },
      { en: 'Data review & guided setup', es: 'Revision de datos y configuracion guiada' },
      { en: 'Board-ready bilingual PDF', es: 'PDF bilingue listo para junta' },
      { en: '12 COSSEC/NCUA ratios', es: '12 ratios COSSEC/NCUA' },
    ],
  },
  PILOT: {
    id: 'monthly',
    amount: 2500,
    label: '$2,500',
    labelEs: '$2,500',
    cadence: '/month',
    cadenceEs: '/mes',
    description: 'Recurring access',
    descriptionEs: 'Acceso recurrente',
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PILOT_PRICE_ID ?? '',
    featured: true,
    bullets: [
      { en: 'Full ALM platform access', es: 'Acceso completo a la plataforma ALM' },
      { en: 'Recurring upload-to-report workflow', es: 'Flujo recurrente de carga a informe' },
      { en: 'AI-powered CERNIQ Analyst', es: 'Analista CERNIQ con IA' },
      { en: '90-day pilot, cancel anytime', es: 'Piloto de 90 dias, cancele en cualquier momento' },
    ],
  },
  STANDARD: {
    id: 'annual',
    amount: 3500,
    label: '$3,500',
    labelEs: '$3,500',
    cadence: '/month',
    cadenceEs: '/mes',
    description: 'Annual access',
    descriptionEs: 'Acceso anual',
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ?? '',
    featured: false,
    bullets: [
      { en: 'Everything in Pilot', es: 'Todo lo incluido en Piloto' },
      { en: 'Annual commitment, priority support', es: 'Compromiso anual, soporte prioritario' },
      { en: 'Unlimited users per institution', es: 'Usuarios ilimitados por institucion' },
      { en: 'HJM Monte Carlo + credit risk engine', es: 'Motor HJM Monte Carlo + riesgo crediticio' },
    ],
  },
  PARTNER: {
    id: 'partner',
    amount: 499,
    label: '$499',
    labelEs: '$499',
    cadence: '/month',
    cadenceEs: '/mes',
    description: 'Partner access',
    descriptionEs: 'Acceso para socios',
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID ?? '',
    featured: false,
    bullets: [
      { en: 'Multi-client workflow', es: 'Flujo de trabajo multi-cliente' },
      { en: 'Partner workspace access', es: 'Acceso al espacio para partners' },
      { en: 'White-label delivery support', es: 'Soporte de entrega white-label' },
      { en: 'Client management dashboard', es: 'Panel de administracion de clientes' },
    ],
  },
} as const;

/** Ordered list of tiers for rendering. */
export const PRICING_TIERS: PricingTier[] = [
  PRICING.SETUP,
  PRICING.PILOT,
  PRICING.STANDARD,
  PRICING.PARTNER,
];

/** Helper: render price + cadence for a tier in the current language. */
export function formatTierPrice(
  tier: PricingTier,
  lang: 'en' | 'es',
): string {
  const label = lang === 'en' ? tier.label : tier.labelEs;
  const cadence = lang === 'en' ? tier.cadence : tier.cadenceEs;

  if (!cadence) {
    return label;
  }

  return cadence.startsWith('/') ? `${label}${cadence}` : `${label} ${cadence}`;
}

/** Helper: get CTA label for a tier. */
export function getCtaLabel(tierId: string, lang: 'en' | 'es'): string {
  const tier = PRICING_TIERS.find((t) => t.id === tierId);
  const acquisition = getAcquisitionCopy(lang);

  if (!tier) return acquisition.primaryCta;

  if (tierId === 'partner') {
    return acquisition.salesCta;
  }

  if (tierId === 'one_time') {
    const price = lang === 'en' ? tier.label : tier.labelEs;
    return `${acquisition.primaryCta} — ${price}`;
  }

  return acquisition.upgradeCta;
}
