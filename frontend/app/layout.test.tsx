import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import RootLayout, { metadata } from './layout';
import { PRICING } from '@/lib/pricing';

vi.mock('next/script', () => ({
  default: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    id?: string;
    strategy?: string;
  }) => <script {...props}>{children}</script>,
}));

vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

vi.mock('@/components/Providers', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/CookieConsent', () => ({
  default: () => <div data-testid="cookie-consent" />,
}));

vi.mock('@/components/SessionTimeoutWarning', () => ({
  default: () => <div data-testid="session-timeout" />,
}));

vi.mock('@/components/Toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/WebVitals', () => ({
  WebVitals: () => <div data-testid="web-vitals" />,
}));

describe('RootLayout metadata', () => {
  it('keeps the broader command-center metadata intact', () => {
    expect(metadata.title).toBe(
      'CERNIQ — Institutional Treasury, Risk, and Portfolio Intelligence',
    );
    expect(metadata.description).toMatch(/institutional operating system/i);
    expect(metadata.openGraph?.title).toBe(
      'CERNIQ — Treasury and Risk Operating System',
    );
  });

  it('renders structured data with the canonical recurring price', () => {
    type LayoutTree = ReactElement<{ children: ReactNode[] }>;
    type HeadElement = ReactElement<{ children: ReactNode }>;
    type StructuredDataScript = ReactElement<{
      dangerouslySetInnerHTML: { __html: string };
    }>;

    const tree = RootLayout({
      children: <main>Page</main>,
    }) as LayoutTree;
    const htmlChildren = tree.props.children;
    const head = htmlChildren[0] as HeadElement;
    const script = head.props.children as StructuredDataScript;
    const structuredData = script.props.dangerouslySetInnerHTML.__html as string;

    expect(structuredData).toContain(`"price":"${PRICING.PILOT.amount}"`);
    expect(structuredData).toContain(
      'Recurring treasury, risk, and portfolio command-center access',
    );
  });
});
