import type { Metadata } from 'next';
import { DemoErrorBoundary } from './DemoErrorBoundary';

export const metadata: Metadata = {
  title: 'Interactive Demo — CERNIQ Treasury and Risk Platform',
  description:
    'Walk through CERNIQ as an institutional command center spanning reporting, risk review, portfolio context, and adjacent finance workflows.',
  alternates: { canonical: '/demo' },
  openGraph: {
    title: 'Try CERNIQ — Interactive Treasury and Risk Demo',
    description:
      'Interactive walkthrough of CERNIQ reporting, workflow control, and institutional finance surfaces.',
    url: 'https://cerniq.io/demo',
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <DemoErrorBoundary>
      {children}
    </DemoErrorBoundary>
  );
}
