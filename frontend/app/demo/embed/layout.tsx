import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Embeddable Demo — CERNIQ',
  description: 'Embeddable risk profile demo showcasing ALM metrics, capital ratios, and downloadable reports.',
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
