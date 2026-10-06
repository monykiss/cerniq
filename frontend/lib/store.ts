import { create } from 'zustand';
import { apiClient } from './api';
import {
    normalizePlatformAccess,
    type PlatformAccessState,
} from './access';
import { authFetch } from './auth-fetch';
import { isSupabaseAuthEnabled } from './supabase/client';
import { syncSupabaseAccessTokenToStorage } from './supabase/session';

interface User {
    id: string;
    email: string;
    name?: string;
}

interface SessionBootstrapPayload {
    authenticated: boolean;
    user?: User & { access?: unknown };
}

interface AuthState {
    user: User | null;
    access: PlatformAccessState | null;
    initialized: boolean;
    isAuthenticated: boolean;
    authRevision: number;
    onboardingComplete: boolean;
    hydrateFromStorage: () => Promise<void>;
    initializeAnonymous: () => void;
    setUser: (user: User | null) => void;
    setAccess: (access: PlatformAccessState | null) => void;
    setSession: (user: User | null, access: PlatformAccessState | null) => void;
    setOnboardingComplete: (complete: boolean) => void;
    logout: () => Promise<void>;
}

const AUTH_USER_STORAGE_KEY = 'cerniq_auth_user';
const LEGACY_AUTH_USER_STORAGE_KEY = 'capex_auth_user';
const onboardingKey = (userId: string) => `cerniq_onboarding_${userId}`;
const legacyOnboardingKey = (userId: string) => `capex_onboarding_${userId}`;

function shouldProbeServerSession() {
    if (typeof window === 'undefined') {
        return false;
    }

    const nodeApiUrl = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim();
    if (!nodeApiUrl) {
        return true;
    }

    try {
        const apiUrl = new URL(nodeApiUrl, window.location.origin);
        const localHosts = new Set(['localhost', '127.0.0.1']);
        const isLocalFrontend = localHosts.has(window.location.hostname);
        const isLocalBackend = localHosts.has(apiUrl.hostname);

        if (isLocalFrontend && isLocalBackend && apiUrl.origin !== window.location.origin) {
            return false;
        }
    } catch {
        return true;
    }

    return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeUser(payload: unknown): User | null {
    const payloadRecord = asRecord(payload);
    const maybeNestedUser = payloadRecord?.user;
    const candidate = asRecord(maybeNestedUser) ?? payloadRecord;
    if (!candidate) {
        return null;
    }

    const id = candidate.id ?? candidate.user_id ?? candidate.sub ?? candidate.email;
    const email = candidate.email;
    if (typeof id !== 'string' || typeof email !== 'string' || !id || !email) {
        return null;
    }

    return {
        id,
        email,
        name: typeof candidate.name === 'string' ? candidate.name : undefined,
    };
}

function hasStoredOnboardingFlag(userId: string) {
    return typeof window !== 'undefined' && localStorage.getItem(onboardingKey(userId)) === 'true';
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    access: null,
    initialized: false,
    isAuthenticated: false,
    authRevision: 0,
    onboardingComplete: false,
    hydrateFromStorage: async () => {
        if (typeof window === 'undefined') {
            set({ initialized: true });
            return;
        }

        // NOTE: Do NOT flip `initialized` back to `false` here. `initialized`
        // means "auth has resolved at least once" — the initial store state is
        // already `false`, so first boot still shows the loading state until the
        // first hydrate completes. Re-probing the server session mid-app (e.g.
        // from /auth/callback or a dashboard refresh) must stay transparent:
        // blipping `initialized` false re-triggers every consumer that gates on
        // it, and on /auth/callback that produced an infinite re-hydration loop
        // that hammered /api/auth/session and never redirected. Each branch
        // below still ends by setting `initialized: true`.

        const setUnauthenticated = () =>
            set((state) => ({
                user: null,
                access: null,
                isAuthenticated: false,
                authRevision: state.authRevision + 1,
                onboardingComplete: false,
                initialized: true,
            }));

        const setAuthenticated = (
            user: User,
            access: PlatformAccessState | null,
        ) => {
            localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
            const onboardingComplete = hasStoredOnboardingFlag(user.id);
            set((state) => ({
                user,
                access,
                isAuthenticated: true,
                authRevision: state.authRevision + 1,
                onboardingComplete,
                initialized: true,
            }));
        };

        // Supabase-issued sessions (password AND OAuth) authenticate with an
        // `Authorization: Bearer` header, not a cookie — so the `/api/auth/session`
        // probe below (which only forwards cookies) can never see them. Resolve
        // them first: sync the Supabase access token into sessionStorage, where
        // the axios interceptor picks it up, then read the profile with it.
        // Without this, a successful Google sign-in would land authenticated in
        // Supabase but "logged out" in the app and bounce back to /login.
        if (isSupabaseAuthEnabled()) {
            try {
                const supabaseToken = await syncSupabaseAccessTokenToStorage();
                if (supabaseToken) {
                    const profile = await apiClient.getCurrentUser();
                    const supabaseUser = normalizeUser(profile);
                    if (supabaseUser) {
                        setAuthenticated(
                            supabaseUser,
                            normalizePlatformAccess(
                                (profile as { access?: unknown } | null)?.access ?? null,
                            ),
                        );
                        return;
                    }
                }
            } catch {
                // Fall through to the cookie/localStorage paths below. A failed
                // profile read here is not authoritative — the legacy cookie
                // session or a cached user may still be valid.
            }
        }

        // Migrate legacy capex_ keys to cerniq_ keys
        const legacyRaw = localStorage.getItem(LEGACY_AUTH_USER_STORAGE_KEY);
        if (legacyRaw) {
            localStorage.setItem(AUTH_USER_STORAGE_KEY, legacyRaw);
            localStorage.removeItem(LEGACY_AUTH_USER_STORAGE_KEY);
            // Also migrate onboarding key for this user
            try {
                const legacyUser = normalizeUser(JSON.parse(legacyRaw));
                if (legacyUser) {
                    const legacyOnboarding = localStorage.getItem(legacyOnboardingKey(legacyUser.id));
                    if (legacyOnboarding) {
                        localStorage.setItem(onboardingKey(legacyUser.id), legacyOnboarding);
                        localStorage.removeItem(legacyOnboardingKey(legacyUser.id));
                    }
                }
            } catch { /* best-effort migration */ }
        }

        const storedUserRaw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
        let cachedUser: User | null = null;
        if (storedUserRaw) {
            try {
                const parsedUser = normalizeUser(JSON.parse(storedUserRaw));
                if (parsedUser) {
                    cachedUser = parsedUser;
                    if (!shouldProbeServerSession()) {
                        setAuthenticated(parsedUser, null);
                        return;
                    }
                }
                localStorage.removeItem(AUTH_USER_STORAGE_KEY);
            } catch {
                localStorage.removeItem(AUTH_USER_STORAGE_KEY);
            }
        }

        // OAuth/login may have a valid server-side cookie before localStorage is populated.
        if (shouldProbeServerSession()) {
            try {
                const response = await authFetch('/api/auth/session', {
                    credentials: 'include',
                    cache: 'no-store',
                });
                const profile = response.ok
                    ? (await response.json().catch(() => null) as SessionBootstrapPayload | null)
                    : null;
                const profileUser = normalizeUser(profile?.user ?? null);
                const access = normalizePlatformAccess(profile?.user?.access ?? null);
                if (profile?.authenticated && profileUser) {
                    setAuthenticated(profileUser, access);
                    return;
                }
            } catch {
                // Preserve the locally known user while profile/bootstrap retries settle.
                if (cachedUser) {
                    setAuthenticated(cachedUser, null);
                    return;
                }
            }
        }

        if (cachedUser && !shouldProbeServerSession()) {
            setAuthenticated(cachedUser, null);
            return;
        }

        setUnauthenticated();
    },
    initializeAnonymous: () => {
        set((state) => ({
            user: null,
            access: null,
            isAuthenticated: false,
            authRevision: state.authRevision + 1,
            onboardingComplete: false,
            initialized: true,
        }));
    },
    setUser: (user) => {
        if (typeof window !== 'undefined') {
            if (user) {
                localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
            } else {
                localStorage.removeItem(AUTH_USER_STORAGE_KEY);
            }
        }

        const onboardingComplete = user
            ? hasStoredOnboardingFlag(user.id)
            : false;

        set((state) => ({
            user,
            access: user ? state.access : null,
            isAuthenticated: Boolean(user),
            authRevision: state.authRevision + 1,
            onboardingComplete,
            initialized: true,
        }));
    },
    setAccess: (access) => {
        set({ access });
    },
    setSession: (user, access) => {
        if (typeof window !== 'undefined') {
            if (user) {
                localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
            } else {
                localStorage.removeItem(AUTH_USER_STORAGE_KEY);
            }
        }

        const onboardingComplete = user
            ? hasStoredOnboardingFlag(user.id)
            : false;

        set((state) => ({
            user,
            access,
            isAuthenticated: Boolean(user),
            authRevision: state.authRevision + 1,
            onboardingComplete,
            initialized: true,
        }));
    },
    setOnboardingComplete: (complete) => {
        set((state) => {
            if (typeof window !== 'undefined' && state.user) {
                localStorage.setItem(onboardingKey(state.user.id), String(complete));
            }
            return { onboardingComplete: complete };
        });
    },
    logout: async () => {
        await apiClient.logout();
        if (typeof window !== 'undefined') {
            localStorage.removeItem(AUTH_USER_STORAGE_KEY);
        }
        set((state) => ({
            user: null,
            access: null,
            isAuthenticated: false,
            authRevision: state.authRevision + 1,
            onboardingComplete: false,
            initialized: true,
        }));
    },
}));

interface Portfolio {
    id: string;
    name: string;
    positions: unknown[];
}

interface PortfolioState {
    portfolios: Portfolio[];
    selectedPortfolio: Portfolio | null;
    setPortfolios: (portfolios: Portfolio[]) => void;
    selectPortfolio: (portfolio: Portfolio | null) => void;
    addPortfolio: (portfolio: Portfolio) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
    portfolios: [],
    selectedPortfolio: null,
    setPortfolios: (portfolios) => set({ portfolios }),
    selectPortfolio: (portfolio) => set({ selectedPortfolio: portfolio }),
    addPortfolio: (portfolio) =>
        set((state) => ({ portfolios: [...state.portfolios, portfolio] })),
}));

// Market Data Cache with 60-second TTL
const CACHE_TTL_MS = 60_000;

interface QuoteData {
    ticker: string;
    price: number;
    change: number;
    changePercent: number;
    volume?: number;
    name?: string;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface MarketDataState {
    quotes: Record<string, CacheEntry<QuoteData>>;
    lastUpdated: number | null;
    setQuote: (ticker: string, data: QuoteData) => void;
    setQuotes: (quotes: QuoteData[]) => void;
    getQuote: (ticker: string) => QuoteData | null;
    isStale: (ticker: string) => boolean;
    clearCache: () => void;
}

export const useMarketDataStore = create<MarketDataState>((set, get) => ({
    quotes: {},
    lastUpdated: null,

    setQuote: (ticker, data) =>
        set((state) => ({
            quotes: {
                ...state.quotes,
                [ticker]: { data, timestamp: Date.now() },
            },
            lastUpdated: Date.now(),
        })),

    setQuotes: (quotes) =>
        set((state) => {
            const now = Date.now();
            const updated = { ...state.quotes };
            quotes.forEach((q) => {
                updated[q.ticker] = { data: q, timestamp: now };
            });
            return { quotes: updated, lastUpdated: now };
        }),

    getQuote: (ticker) => {
        const entry = get().quotes[ticker];
        if (!entry) return null;
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
        return entry.data;
    },

    isStale: (ticker) => {
        const entry = get().quotes[ticker];
        if (!entry) return true;
        return Date.now() - entry.timestamp > CACHE_TTL_MS;
    },

    clearCache: () => set({ quotes: {}, lastUpdated: null }),
}));
