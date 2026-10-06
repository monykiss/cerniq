import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In — CERNIQ',
  description:
    'Secure login to your CERNIQ treasury, risk, and reporting workspace.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
