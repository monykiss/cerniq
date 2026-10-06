import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compliance Calendar | ALM Intelligence | CERNIQ',
  description:
    'Regulatory compliance calendar with upcoming deadlines, filing status tracking, required documents, and countdown timers for COSSEC, NCUA, and Basel filings.',
  openGraph: {
    title: 'Compliance Calendar | ALM Intelligence',
    description:
      'Track regulatory deadlines, filing statuses, and required documents for credit union compliance.',
  },
};

export default function ComplianceCalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
