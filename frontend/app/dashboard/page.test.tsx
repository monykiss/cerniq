import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  AnchorHTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react';
import DashboardPage from './page';

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

const authState = {
  initialized: true,
  isAuthenticated: false,
  onboardingComplete: false,
  hydrateFromStorage: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowRight: Icon,
    Briefcase: Icon,
    CheckCircle2: Icon,
    LineChart: Icon,
    LockKeyhole: Icon,
    Upload: Icon,
    ShieldCheck: Icon,
    Target: Icon,
  };
});

describe('DashboardPage', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    authState.initialized = true;
    authState.isAuthenticated = false;
    authState.onboardingComplete = false;
    authState.hydrateFromStorage.mockReset();
  });

  it('shows guest users the command-center entry shell', () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole('heading', {
        name: /open the treasury and risk command center/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /sign in to open workspace/i }),
    ).toHaveAttribute('href', '/login?returnUrl=%2Fdashboard&mode=magic-link');
    expect(
      screen.getByRole('link', { name: /start pilot/i }),
    ).toHaveAttribute('href', '/get-started');
    expect(
      screen.getByRole('link', { name: /view interactive demo/i }),
    ).toHaveAttribute('href', '/demo');
    expect(
      screen.getByRole('link', { name: /ALM and risk models/i }),
    ).toHaveAttribute('href', '/login?returnUrl=%2Falm');
    expect(screen.getByText(/Reporting workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/ALM and risk models/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('routes authenticated users without onboarding to setup completion', () => {
    authState.isAuthenticated = true;
    authState.onboardingComplete = false;

    render(<DashboardPage />);

    expect(
      screen.getByRole('heading', {
        name: /finish institution setup before opening the command center/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /complete setup/i }),
    ).toHaveAttribute('href', '/onboarding');
    expect(
      screen.getByRole('link', { name: /review pilot steps/i }),
    ).toHaveAttribute('href', '/get-started');
    expect(
      screen.getByRole('link', { name: /ALM and risk models/i }),
    ).toHaveAttribute('href', '/alm');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // Regression guard: this page used to router.replace() straight into the
  // portal, which made /dashboard unreachable for every signed-in user — the
  // module shortcuts rendered for one frame and vanished. It must now RENDER.
  it('renders the command center for onboarded users instead of redirecting', async () => {
    authState.isAuthenticated = true;
    authState.onboardingComplete = true;

    render(<DashboardPage />);

    expect(
      await screen.findByRole('heading', {
        name: /your institutional command center/i,
      }),
    ).toBeInTheDocument();

    expect(replaceMock).not.toHaveBeenCalled();

    // The portal stays the primary call to action, just no longer forced.
    expect(
      screen.getByRole('link', { name: /continue to reporting workspace/i }),
    ).toHaveAttribute('href', '/portal/submit?createCycle=1');
    expect(
      screen.getByRole('link', { name: /alm and risk models/i }),
    ).toHaveAttribute('href', '/alm');
  });
});
