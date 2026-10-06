import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccessRequiredPage from './page';

const mockReplace = vi.fn();
const mockLogout = vi.fn();
const mockState = {
  initialized: true,
  isAuthenticated: false,
  user: null as null | { email: string },
  access: null,
  onboardingComplete: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({
    ...mockState,
    logout: mockLogout,
  }),
}));

describe('AccessRequiredPage', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockLogout.mockReset();
    mockState.initialized = true;
    mockState.isAuthenticated = false;
    mockState.user = null;
    mockState.access = null;
    mockState.onboardingComplete = false;
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits briefly before redirecting unauthenticated users when a stored auth hint exists', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      'cerniq_auth_user',
      JSON.stringify({ id: 'user-1', email: 'owner@cerniq.io' }),
    );

    render(<AccessRequiredPage />);

    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
