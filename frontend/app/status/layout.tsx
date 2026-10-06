import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Status — CERNIQ',
  description: 'CERNIQ platform health and service status.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
