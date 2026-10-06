import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Peer Benchmarking | ALM Intelligence | CERNIQ',
  description:
    'Compare your credit union metrics against peer medians. Percentile rankings, risk flags, and sector overview for CFOs.',
  openGraph: {
    title: 'Peer Benchmarking | ALM Intelligence',
    description:
      'See how your institution stacks up against peers with percentile rankings, outlier detection, and sector-wide trends.',
  },
};

export default function PeerBenchmarkingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
