import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing — CERNIQ Treasury and Risk Platform | From $750',
  description:
    'Start with a $750 pilot, then move into recurring treasury and risk platform access. CERNIQ replaces fragmented reporting workflows with one institutional operating surface.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'CERNIQ Pricing — Institutional Treasury and Risk Access',
    description:
      'Pilot at $750, recurring access at $2,500/mo, and annual access at $3,500/mo for treasury, risk, and board-ready reporting workflows.',
    url: 'https://cerniq.io/pricing',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
