import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Documentation — CERNIQ Developer Portal',
  description: 'CERNIQ REST API documentation. ALM analysis, regulatory compliance, stress testing, and benchmarking endpoints for programmatic integration.',
  alternates: { canonical: '/developers' },
  openGraph: {
    title: 'CERNIQ API — Developer Documentation',
    description: '142 API endpoints. ALM analysis, CECL, Monte Carlo, yield curve modeling. Swagger UI at /api/v1/docs.',
    url: 'https://cerniq.io/developers',
  },
};

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
