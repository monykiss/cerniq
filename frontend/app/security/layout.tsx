import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security — CERNIQ Treasury and Risk Platform',
  description:
    'Enterprise security controls for the CERNIQ treasury and risk platform: AES-256 encryption, TLS 1.3, role-based access, audit logging, and institutional-grade infrastructure.',
  alternates: { canonical: '/security' },
  openGraph: {
    title: 'Security at CERNIQ',
    description:
      'AES-256 at rest, TLS 1.3 in transit, RBAC, audit logging, and institutional security controls for CERNIQ.',
    url: 'https://cerniq.io/security',
  },
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
