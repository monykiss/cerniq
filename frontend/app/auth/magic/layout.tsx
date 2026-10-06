import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Magic Link — CERNIQ',
  description: 'Verifying your secure magic link login for CERNIQ.',
};

export default function MagicLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
