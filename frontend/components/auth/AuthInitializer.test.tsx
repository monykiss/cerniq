import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AuthInitializer from './AuthInitializer';
import { APP_NAVIGATION_EVENT } from '@/lib/api';

const mockHydrateFromStorage = vi.fn();
const mockInitializeAnonymous = vi.fn();
const mockUsePathname = vi.fn();
const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockState = {
  initialized: false,
  isAuthenticated: false,
  access: null as null | { platformAccessAllowed: boolean },
};

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (state: {
    initialized: boolean;
    isAuthenticated: boolean;
    access: null | { platformAccessAllowed: boolean };
    hydrateFromStorage: typeof mockHydrateFromStorage;
    initializeAnonymous: typeof mockInitializeAnonymous;
  }) => unknown) =>
    selector({
      initialized: mockState.initialized,
      isAuthenticated: mockState.isAuthenticated,
      access: mockState.access,
      hydrateFromStorage: mockHydrateFromStorage,
      initializeAnonymous: mockInitializeAnonymous,
    }),
}));

describe('AuthInitializer', () => {
  beforeEach(() => {
    mockState.initialized = false;
    mockState.isAuthenticated = false;
    mockState.access = null;
    mockUsePathname.mockReturnValue('/');
    mockHydrateFromStorage.mockReset();
    mockInitializeAnonymous.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('hydrates on auth-relevant routes', () => {
    mockUsePathname.mockReturnValue('/dashboard');

    render(<AuthInitializer />);

    expect(mockHydrateFromStorage).toHaveBeenCalledTimes(1);
  });

  it('initializes anonymous auth state on portal login without a stored auth hint', () => {
    mockUsePathname.mockReturnValue('/portal/login');

    render(<AuthInitializer />);

    expect(mockHydrateFromStorage).not.toHaveBeenCalled();
    expect(mockInitializeAnonymous).toHaveBeenCalledTimes(1);
  });

  it('hydrates on anonymous entry routes when a stored auth hint exists', () => {
    mockUsePathname.mockReturnValue('/portal/login');
    window.localStorage.setItem('cerniq_auth_user', JSON.stringify({ id: 'u_1', email: 'test@cerniq.io' }));

    render(<AuthInitializer />);

    expect(mockHydrateFromStorage).toHaveBeenCalledTimes(1);
  });

  it('skips hydration on anonymous public routes', () => {
    mockUsePathname.mockReturnValue('/pricing');

    render(<AuthInitializer />);

    expect(mockHydrateFromStorage).not.toHaveBeenCalled();
    expect(mockInitializeAnonymous).toHaveBeenCalledTimes(1);
  });

  it('hydrates once when entering auth scope and does not repeat inside it', () => {
    mockUsePathname.mockReturnValue('/pricing');
    window.localStorage.setItem('cerniq_auth_user', JSON.stringify({ id: 'u_1', email: 'test@cerniq.io' }));

    const { rerender } = render(<AuthInitializer />);

    mockUsePathname.mockReturnValue('/dashboard');
    mockState.initialized = true;
    rerender(<AuthInitializer />);

    mockUsePathname.mockReturnValue('/dashboard/upload');
    rerender(<AuthInitializer />);

    expect(mockHydrateFromStorage).toHaveBeenCalledTimes(1);
  });

  it('redirects blocked authenticated users to access-required on protected routes', () => {
    mockState.initialized = true;
    mockState.isAuthenticated = true;
    mockState.access = { platformAccessAllowed: false };
    mockUsePathname.mockReturnValue('/dashboard');

    render(<AuthInitializer />);

    expect(mockReplace).toHaveBeenCalledWith('/access-required');
  });

  it('redirects unpaid users away from /alm to access-required — hard pay gate (#96)', () => {
    mockState.initialized = true;
    mockState.isAuthenticated = true;
    mockState.access = { platformAccessAllowed: false };
    mockUsePathname.mockReturnValue('/alm');

    render(<AuthInitializer />);

    expect(mockReplace).toHaveBeenCalledWith('/access-required');
  });

  it('redirects anonymous users on protected routes to login with a returnUrl', () => {
    mockState.initialized = true;
    mockUsePathname.mockReturnValue('/dashboard');

    render(<AuthInitializer />);

    expect(mockReplace).toHaveBeenCalledWith(
      '/login?returnUrl=%2Fdashboard&mode=magic-link',
    );
  });

  it('handles shared app navigation events with client-side replace routing', () => {
    mockState.initialized = true;
    render(<AuthInitializer />);

    window.dispatchEvent(
      new CustomEvent(APP_NAVIGATION_EVENT, {
        detail: { href: '/access-required', replace: true },
      }),
    );

    expect(mockReplace).toHaveBeenCalledWith('/access-required');
  });
});
