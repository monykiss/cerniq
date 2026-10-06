import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:
    'Public Compliance Matrix — CERNIQ | COSSEC, NCUA, Basel IRRBB, CECL',
  description:
    'Buyer-facing compliance matrix for CERNIQ. Review the current public coverage map across 20 requirements covering COSSEC, NCUA, Basel IRRBB, and CECL workflows.',
  alternates: { canonical: '/compliance' },
  openGraph: {
    title: 'CERNIQ Public Compliance Matrix — 20 Requirements, 4 Frameworks',
    description:
      'Procurement-ready view of CERNIQ public claims across COSSEC, NCUA, Basel IRRBB, and CECL workflows.',
    url: 'https://cerniq.io/compliance',
  },
};

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
