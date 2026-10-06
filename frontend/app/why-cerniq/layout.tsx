import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Why CERNIQ — Treasury and Risk Operating System',
  description:
    'Why finance teams choose CERNIQ: one institutional command surface for treasury, risk, portfolio visibility, and board-ready reporting.',
  alternates: { canonical: '/why-cerniq' },
  openGraph: {
    title: 'Why CERNIQ — Built for Institutional Treasury and Risk Teams',
    description:
      'CERNIQ unifies reporting, rate posture, portfolio visibility, and board delivery in one operating system.',
    url: 'https://cerniq.io/why-cerniq',
  },
};

export default function WhyCerniqLayout({ children }: { children: React.ReactNode }) {
  return children;
}
