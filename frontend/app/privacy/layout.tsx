import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — CERNIQ',
  description: 'How CERNIQ protects your institution\'s financial data. AES-256 encryption, RBAC access control, data retention policies, and your rights.',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
