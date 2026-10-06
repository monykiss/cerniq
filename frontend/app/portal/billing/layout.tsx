import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Billing — CERNIQ',
  description: 'Manage your CERNIQ subscription, view invoices, and update payment methods.',
};

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
