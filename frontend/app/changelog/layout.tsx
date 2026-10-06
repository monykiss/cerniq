import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog — CERNIQ Platform Updates',
  description: 'Latest CERNIQ platform releases, new ALM modules, quant model additions, and feature updates. See what\'s new.',
  alternates: { canonical: '/changelog' },
  openGraph: {
    title: 'CERNIQ Changelog — What\'s New',
    description: 'Platform updates: new quant models, regulatory modules, performance improvements, and more.',
    url: 'https://cerniq.io/changelog',
  },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
