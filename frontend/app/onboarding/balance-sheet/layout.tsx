import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Balance Sheet Entry — CERNIQ',
  description:
    'Guided balance sheet data entry wizard for credit union CFOs. Input assets, liabilities, capital, and income statement data for ALM analysis.',
};

export default function BalanceSheetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
