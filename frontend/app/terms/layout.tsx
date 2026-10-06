import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — CERNIQ',
  description: 'CERNIQ Terms of Service. Data ownership, billing, disclaimers, and governing law for the ALM intelligence platform by KLYTICS LLC.',
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
