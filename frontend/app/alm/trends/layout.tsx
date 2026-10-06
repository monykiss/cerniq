import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Historical Trends | ALM Intelligence | CERNIQ',
  description:
    'Track risk score, capital ratio, LCR, and duration gap over time. Visualize historical ALM metrics with interactive trend charts.',
  openGraph: {
    title: 'Historical Trends | ALM Intelligence',
    description:
      'Interactive trend analysis for credit union and bank ALM metrics.',
  },
};

export default function TrendsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
