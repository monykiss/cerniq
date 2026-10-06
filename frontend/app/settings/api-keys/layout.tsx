import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Keys — CERNIQ',
  description: 'Create and manage read-only API integration keys for your CERNIQ account.',
};

export default function ApiKeysLayout({ children }: { children: React.ReactNode }) {
  return children;
}
