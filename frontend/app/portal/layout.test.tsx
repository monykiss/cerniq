import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from 'react';
import PortalLayout from './layout';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const fetchMock = vi.fn();
let pathname = '/portal';
const router = {
  replace: replaceMock,
  push: pushMock,
};

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqLockup: () => <div data-testid="cerniq-lockup" />,
}));

vi.mock('@/components/portal/PortalPaywall', () => ({
  default: () => <div>Portal paywall</div>,
}));

vi.mock('@/lib/subscription', () => ({
  requiresPortalPaywall: vi.fn(() => false),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    BarChart3: Icon,
    Upload: Icon,
    CreditCard: Icon,
    Settings: Icon,
    LogOut: Icon,
    HelpCircle: Icon,
  };
});

describe('PortalLayout', () => {
  beforeEach(() => {
    pathname = '/portal';
    replaceMock.mockReset();
    pushMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders portal content after wrapped profile and subscription responses load', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          user: {
            id: 'portal-user-1',
            email: 'qa@cerniq.io',
            name: 'CERNIQ QA',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            tier: 'monthly',
            status: 'active',
          },
        }),
      });

    render(
      <PortalLayout>
        <div>Protected portal content</div>
      </PortalLayout>,
    );

    expect(screen.getByText('Loading portal...')).toBeInTheDocument();
    expect(await screen.findByText('Protected portal content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('keeps protected content hidden while redirecting unauthenticated users', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authenticated: false }),
    });

    render(
      <PortalLayout>
        <div>Protected portal content</div>
      </PortalLayout>,
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        '/login?returnUrl=%2Fportal&mode=magic-link',
      );
    });

    expect(screen.queryByText('Protected portal content')).not.toBeInTheDocument();
    expect(screen.getByText('Loading portal...')).toBeInTheDocument();
  });

  it('skips the auth bootstrap on the portal login route', async () => {
    pathname = '/portal/login';

    render(
      <PortalLayout>
        <div>Portal login content</div>
      </PortalLayout>,
    );

    expect(await screen.findByText('Portal login content')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
