import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCurrentUser, mockIsSupabaseAuthEnabled, mockSyncSupabaseToken } =
  vi.hoisted(() => ({
    mockGetCurrentUser: vi.fn(),
    mockIsSupabaseAuthEnabled: vi.fn(() => false),
    mockSyncSupabaseToken: vi.fn(async () => ''),
  }));

vi.mock('./api', () => ({
  apiClient: {
    getCurrentUser: mockGetCurrentUser,
    logout: vi.fn(),
  },
}));

vi.mock('./supabase/client', () => ({
  isSupabaseAuthEnabled: mockIsSupabaseAuthEnabled,
}));

vi.mock('./supabase/session', () => ({
  syncSupabaseAccessTokenToStorage: mockSyncSupabaseToken,
}));

import { useAuthStore } from './store';

describe('useAuthStore', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
    mockIsSupabaseAuthEnabled.mockReset();
    mockIsSupabaseAuthEnabled.mockReturnValue(false);
    mockSyncSupabaseToken.mockReset();
    mockSyncSupabaseToken.mockResolvedValue('');
    window.localStorage.clear();
    window.sessionStorage.clear();
    useAuthStore.setState({
      user: null,
      access: null,
      initialized: false,
      isAuthenticated: false,
      authRevision: 0,
      onboardingComplete: false,
    });
  });

  it('keeps the cached user authenticated when the profile probe fails transiently', async () => {
    window.localStorage.setItem(
      'cerniq_auth_user',
      JSON.stringify({ id: 'user-1', email: 'owner@cerniq.io' }),
    );
    mockGetCurrentUser.mockRejectedValue(new Error('temporary outage'));

    await useAuthStore.getState().hydrateFromStorage();

    const state = useAuthStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({
      id: 'user-1',
      email: 'owner@cerniq.io',
    });
    expect(state.access).toBeNull();
  });

  it('does not un-initialize the app when re-probing an already-initialized session', async () => {
    // Regression guard for the /auth/callback infinite re-hydration loop:
    // hydrateFromStorage used to `set({ initialized: false })` at its start.
    // Any component subscribed to `initialized` (the callback page, the
    // AuthInitializer) then tore down and re-ran its effect on every re-probe,
    // which re-triggered hydrate — an unbounded loop that hammered
    // /api/auth/session and never redirected. Once the app has booted,
    // re-probing must stay transparent: `initialized` must never dip to false.
    useAuthStore.setState({ initialized: true, isAuthenticated: false });

    const observed: boolean[] = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      observed.push(state.initialized);
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await useAuthStore.getState().hydrateFromStorage();
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }

    expect(observed).not.toContain(false);
    expect(useAuthStore.getState().initialized).toBe(true);
  });

  it('authenticates a Supabase bearer session that the cookie probe cannot see', async () => {
    // Phase 4 Google/OAuth sign-in issues a *Supabase* session, which travels as
    // an `Authorization: Bearer` header — the `/api/auth/session` probe only
    // forwards cookies, so it returns authenticated:false for these users.
    // Without the Supabase-first branch in hydrateFromStorage, a successful
    // Google sign-in would land authenticated in Supabase but "logged out" in
    // the app and bounce straight back to /login.
    mockIsSupabaseAuthEnabled.mockReturnValue(true);
    mockSyncSupabaseToken.mockResolvedValue('supabase-jwt');
    mockGetCurrentUser.mockResolvedValue({
      id: 'google-user',
      email: 'founder@cerniq.io',
      name: 'Founder',
    });

    // The cookie probe explicitly denies the session, proving authentication
    // came from the Supabase bearer path and not from a cookie fallback.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await useAuthStore.getState().hydrateFromStorage();
    } finally {
      vi.unstubAllGlobals();
    }

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({
      id: 'google-user',
      email: 'founder@cerniq.io',
    });
    expect(state.initialized).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the cookie session when Supabase has no token', async () => {
    // Supabase configured but not signed in (e.g. legacy cookie user): the
    // Supabase branch must not short-circuit or strand the cookie session.
    mockIsSupabaseAuthEnabled.mockReturnValue(true);
    mockSyncSupabaseToken.mockResolvedValue('');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: { id: 'cookie-user', email: 'cookie@cerniq.io' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await useAuthStore.getState().hydrateFromStorage();
    } finally {
      vi.unstubAllGlobals();
    }

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({ id: 'cookie-user' });
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });
});
