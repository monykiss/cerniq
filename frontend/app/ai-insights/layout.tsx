import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Insights — CERNIQ',
  description: 'Real-time AI-powered market sentiment analysis, Fear & Greed index, and sector performance.',
};

export default function AIInsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
