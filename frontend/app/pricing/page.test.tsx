import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from 'react';
import PricingPage from './page';
import { PRICING, PRICING_TIERS, formatTierPrice } from '@/lib/pricing';
import { PUBLIC_PATHS } from '@/lib/public-links';

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/billing', () => ({
  createCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { track: vi.fn() },
  EVENTS: { CHECKOUT_STARTED: 'Checkout Started' },
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqMark: () => <div data-testid="cerniq-mark" />,
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  CheckCircle2: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  ChevronRight: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  HelpCircle: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

describe('PricingPage', () => {
  it('routes the one-time pilot CTA into /get-started instead of direct checkout', () => {
    render(<PricingPage />);

    fireEvent.click(screen.getByRole('button', { name: /Start Pilot — \$750/i }));

    expect(pushMock).toHaveBeenCalledWith(PUBLIC_PATHS.getStarted);
  });

  it('renders all four pricing tiers from lib/pricing.ts', () => {
    render(<PricingPage />);

    // Assert from the single source of truth — PRICING_TIERS
    for (const tier of PRICING_TIERS) {
      expect(screen.getAllByText(tier.label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('renders CTA buttons for checkout tiers and contact link for partner', () => {
    render(<PricingPage />);

    const startButtons = screen.getAllByRole('button', { name: /Start Pilot/i });
    expect(startButtons.length).toBeGreaterThanOrEqual(1);

    const upgradeButtons = screen.getAllByRole('button', { name: /Upgrade to Recurring Access/i });
    expect(upgradeButtons.length).toBeGreaterThanOrEqual(2);

    expect(screen.getAllByRole('link', { name: /Contact Sales/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the pricing tiers section with proper aria-label', () => {
    render(<PricingPage />);
    expect(screen.getByLabelText('Pricing tiers')).toBeInTheDocument();
  });

  it('renders the FAQ section', () => {
    render(<PricingPage />);
    expect(screen.getByText('FAQ')).toBeInTheDocument();
    expect(screen.getByText(/Why start with a pilot/i)).toBeInTheDocument();
  });

  it('keeps the page framed around the pilot-first path', () => {
    render(<PricingPage />);

    expect(
      screen.getByText(
        /Start with the pilot\. Expand into the institutional operating surface once the workflow is trusted\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/View Interactive Demo/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Request Demo/i)).not.toBeInTheDocument();
  });

  it('renders recurring pricing from the canonical pricing contract', () => {
    render(<PricingPage />);

    expect(
      screen.getAllByText(formatTierPrice(PRICING.PILOT, 'en')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Recurring command-center access/i),
    ).toBeInTheDocument();
  });
});
