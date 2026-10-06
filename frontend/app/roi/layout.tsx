import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ROI Calculator — CERNIQ | Calculate Your ALM Savings',
  description: 'Calculate how much your institution saves with CERNIQ vs. traditional ALM consultants. Interactive sliders for hours, rates, and report volume.',
  alternates: { canonical: '/roi' },
  openGraph: {
    title: 'CERNIQ ROI Calculator — See Your Savings',
    description: 'Most cooperativas save $15,000-$30,000/year switching from manual ALM to CERNIQ. Calculate yours.',
    url: 'https://cerniq.io/roi',
  },
};

export default function ROILayout({ children }: { children: React.ReactNode }) {
  return children;
}
