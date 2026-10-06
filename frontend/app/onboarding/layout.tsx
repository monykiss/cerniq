import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Setup — CERNIQ',
  description: 'Complete your institution profile to start generating ALM reports.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
