import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Account — CERNIQ',
  description:
    'Create your CERNIQ account to access the institutional treasury, risk, and reporting workspace.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
