import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact Sales — CERNIQ Treasury and Risk Platform',
  description:
    'Talk to CERNIQ about partner pricing, assisted rollout, advisor workflows, or security review for the institutional treasury and risk platform.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact Sales — CERNIQ',
    description:
      'Partner, enterprise, and assisted rollout conversations for CERNIQ treasury, risk, and board-output workflows.',
    url: 'https://cerniq.io/contact',
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
