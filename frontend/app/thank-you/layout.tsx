import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Thank You — CERNIQ',
  description: 'Thank you for your feedback. Share additional comments to help us improve.',
};

export default function ThankYouLayout({ children }: { children: React.ReactNode }) {
  return children;
}
