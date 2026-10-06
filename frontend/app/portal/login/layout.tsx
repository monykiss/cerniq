import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portal Login — CERNIQ',
  description: 'Sign in to your CERNIQ portal workspace with a secure magic link.',
};

export default function PortalLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
