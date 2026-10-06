import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SVGProps } from 'react';
import LandingPage from './page';
import { PUBLIC_PATHS } from '@/lib/public-links';

const {
  analyticsTrackMock,
  createCheckoutSessionMock,
  pushMock,
  submitDemoRequestMock,
} = vi.hoisted(() => ({
  analyticsTrackMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
  pushMock: vi.fn(),
  submitDemoRequestMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    submitDemoRequest: submitDemoRequestMock,
  },
}));

vi.mock('@/lib/billing', () => ({
  createCheckoutSession: createCheckoutSessionMock,
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { track: analyticsTrackMock },
  EVENTS: {
    LEAD_FORM_SUBMITTED: 'Lead Form Submitted',
    CHECKOUT_STARTED: 'Checkout Started',
  },
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqMark: () => <div data-testid="cerniq-mark" />,
  CerniqLockup: ({ tagline }: { tagline: string }) => <div>{tagline}</div>,
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowRight: Icon,
    BarChart3: Icon,
    Building2: Icon,
    CheckCircle2: Icon,
    ChevronRight: Icon,
    Clock3: Icon,
    FileText: Icon,
    LineChart: Icon,
    PlayCircle: Icon,
    ShieldCheck: Icon,
    Sparkles: Icon,
    Target: Icon,
    Upload: Icon,
    Languages: Icon,
  };
});

describe('LandingPage', () => {
  beforeEach(() => {
    analyticsTrackMock.mockReset();
    createCheckoutSessionMock.mockReset();
    pushMock.mockReset();
    submitDemoRequestMock.mockReset();
    window.localStorage.clear();
  });

  it('repositions the homepage around treasury, risk, and command-center workflows', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', {
        name: /turn the quarterly ALM scramble into an institutional command center/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/treasury and risk operating system/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /Start Pilot/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/View Interactive Demo/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/One institutional system\. Multiple working surfaces\./i)).toBeInTheDocument();
    expect(screen.getByText(/Tell us how your treasury and risk workflow runs today\./i)).toBeInTheDocument();
    // The homepage is anchored on the surfaces that still exist. "Portfolio
    // visibility" and "Execution review" were removed with the trading line;
    // asserting them here would re-enable copy for modules that 404.
    expect(screen.getAllByText(/Treasury intelligence/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Risk operating system/i).length).toBeGreaterThan(0);
  });

  it('routes compliance navigation through the public compliance path', () => {
    render(<LandingPage />);

    fireEvent.click(screen.getAllByRole('button', { name: /Compliance/i })[0]);
    expect(pushMock).toHaveBeenCalledWith(PUBLIC_PATHS.compliance);

    const complianceLink = screen
      .getByText(/View compliance matrix/i)
      .closest('a');

    expect(complianceLink).toHaveAttribute('href', PUBLIC_PATHS.compliance);
  });

  it('routes the $750 pilot CTA into the get-started intake flow', () => {
    render(<LandingPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /Start Pilot — \$750/i }),
    );

    expect(pushMock).toHaveBeenCalledWith('/get-started');
  });

  it('preserves guest intent for protected command-center buttons', () => {
    render(<LandingPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /run ALM models/i }),
    );
    expect(pushMock).toHaveBeenLastCalledWith('/login?returnUrl=%2Falm');
  });

  it('uses return-aware footer links for protected product modules', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('link', { name: /command center/i }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      screen.getByRole('link', { name: /ALM workspace/i }),
    ).toHaveAttribute('href', '/login?returnUrl=%2Falm');
  });

  it('tracks landing lead submissions with the backward-compatible source label', async () => {
    submitDemoRequestMock.mockResolvedValue({});
    render(<LandingPage />);

    fireEvent.change(screen.getByPlaceholderText(/your name/i), {
      target: { value: 'Maria Rodriguez' },
    });
    fireEvent.change(screen.getByPlaceholderText(/name@institution\.com/i), {
      target: { value: 'maria@institution.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/institution name/i), {
      target: { value: 'Cerniq CU' },
    });
    const [institutionTypeSelect, assetRangeSelect] = screen.getAllByRole('combobox');
    fireEvent.change(institutionTypeSelect, {
      target: { value: 'credit_union' },
    });
    fireEvent.change(assetRangeSelect, {
      target: { value: '$100M-$500M' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /continue to pilot/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(submitDemoRequestMock).toHaveBeenCalled();
    });
    expect(analyticsTrackMock).toHaveBeenCalledWith(
      'Lead Form Submitted',
      expect.objectContaining({
        source: 'landing_page_pilot_intake',
      }),
    );
  });

  it('tracks recurring checkout starts with the existing landing-page source label', async () => {
    createCheckoutSessionMock.mockImplementation(() => new Promise(() => {}));
    render(<LandingPage />);

    const recurringAccessCard = screen
      .getAllByText(/^Recurring access$/i)[0]
      .closest('.cerniq-panel');

    fireEvent.click(
      within(recurringAccessCard as HTMLElement).getByRole('button', {
        name: /upgrade to recurring access/i,
      }),
    );

    await waitFor(() => {
      expect(analyticsTrackMock).toHaveBeenCalledWith(
        'Checkout Started',
        expect.objectContaining({
          source: 'landing_page',
          tier: 'monthly',
        }),
      );
    });
  });
});
