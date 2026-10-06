'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Upload,
  CreditCard,
  Settings,
  LogOut,
  HelpCircle,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CerniqLockup } from '@/components/brand/CerniqLogo';
import PortalPaywall from '@/components/portal/PortalPaywall';
import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';
import {
  normalizePlatformAccess,
  type PlatformAccessState,
} from '@/lib/access';
import {
  requiresPortalPaywall,
  type PortalSubscription,
} from '@/lib/subscription';
import { getPublicApiUrl } from '@/lib/api-base';
import { unwrapApiData } from '@/lib/api-response';

const PROFILE_RETRY_DELAYS_MS =
  process.env.NODE_ENV === 'test' ? [0, 1, 1] : [0, 400, 1000];

interface PortalUser {
  id: string;
  email: string;
  name?: string;
  access?: unknown;
}

interface PortalContextType {
  user: PortalUser | null;
  subscription: PortalSubscription | null;
  access: PlatformAccessState | null;
  loading: boolean;
}

interface SessionPayload {
  authenticated: boolean;
  user?: PortalUser;
}

const PortalContext = createContext<PortalContextType>({
  user: null,
  subscription: null,
  access: null,
  loading: true,
});

export const usePortal = () => useContext(PortalContext);

const NAV_ITEMS = [
  { href: '/portal', label: 'My Reports', icon: BarChart3 },
  { href: '/portal/submit', label: 'Submit Data', icon: Upload },
  { href: '/portal/billing', label: 'Billing', icon: CreditCard },
  { href: '/portal/settings', label: 'Settings', icon: Settings },
];

function normalizePortalUser(payload: unknown): PortalUser | null {
  const unwrapped = unwrapApiData<PortalUser | null>(payload);
  if (!unwrapped?.id || !unwrapped.email) {
    return null;
  }
  return unwrapped;
}

function normalizeSubscription(
  payload: unknown,
): PortalSubscription | null {
  return unwrapApiData<PortalSubscription | null>(payload);
}

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [subscription, setSubscription] = useState<PortalSubscription | null>(
    null,
  );
  const [access, setAccess] = useState<PlatformAccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const isPortalLoginRoute = pathname === '/portal/login';

  useEffect(() => {
    if (isPortalLoginRoute) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadUser() {
      setSessionError('');

      for (const [index, delayMs] of PROFILE_RETRY_DELAYS_MS.entries()) {
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }

        try {
          const profileRes = await authFetch(getPublicApiUrl('/api/auth/session'), {
            credentials: 'include',
            cache: 'no-store',
          });
          const sessionPayload = (await profileRes.json().catch(() => null)) as
            | SessionPayload
            | null;

          if (!sessionPayload?.authenticated || !sessionPayload.user) {
            if (!cancelled) {
              setUser(null);
              setSubscription(null);
              setAccess(null);
              setLoading(false);
              router.replace(
                buildLoginUrlForReturnUrl('/portal', {
                  forceMagicLink: true,
                }),
              );
            }
            return;
          }

          const profilePayload = normalizePortalUser(sessionPayload.user);
          if (!profilePayload) {
            throw new Error('Malformed profile payload');
          }

          const subRes = await authFetch(getPublicApiUrl('/api/billing/subscription'), {
            credentials: 'include',
            cache: 'no-store',
          });
          const subscriptionPayload = subRes.ok
            ? normalizeSubscription(await subRes.json().catch(() => null))
            : null;

          if (!cancelled) {
            setUser(profilePayload);
            setSubscription(subscriptionPayload);
            setAccess(normalizePlatformAccess(profilePayload.access));
            setSessionError('');
            setLoading(false);
          }
          return;
        } catch {
          // Retry below. Network/proxy misses should not bounce the user to login.
        }

        if (index === PROFILE_RETRY_DELAYS_MS.length - 1) {
          if (!cancelled) {
            setSessionError(
              'We could not verify your portal session right now. Please retry.',
            );
            setLoading(false);
          }
        }
      }
    }

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [router, isPortalLoginRoute]);

  const logout = async () => {
    await authFetch(getPublicApiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    });
    router.push('/');
  };

  if (isPortalLoginRoute) {
    return (
      <PortalContext.Provider
        value={{ user, subscription, access, loading: false }}
      >
        <ErrorBoundary context="portal">{children}</ErrorBoundary>
      </PortalContext.Provider>
    );
  }

  if (loading) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          <span className="text-sm text-slate-500">Loading portal...</span>
        </div>
      </div>
    );
  }

  if (!user && !sessionError) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          <span className="text-sm text-slate-500">Loading portal...</span>
        </div>
      </div>
    );
  }

  if (sessionError && !user) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center px-4">
        <div className="cerniq-dashboard-elevated-surface w-full max-w-md rounded-[1.75rem] border p-8 text-center shadow-[0_30px_80px_rgba(113,88,40,0.14)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700/70">
            Session recovery
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">
            Workspace access is still settling
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {sessionError}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-[#1B3A6B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#15305a]"
            >
              Retry session check
            </button>
            <Link
              href={buildLoginUrlForReturnUrl('/portal', {
                forceMagicLink: true,
              })}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const showPortalPaywall = Boolean(
    user &&
      (access
        ? !access.platformAccessAllowed
        : requiresPortalPaywall(subscription)),
  );

  return (
    <PortalContext.Provider value={{ user, subscription, access, loading }}>
      <ErrorBoundary context="portal">
        <div className="cerniq-dashboard-theme flex min-h-screen bg-[var(--dashboard-base)] text-slate-950">
          <aside className="flex w-72 flex-col border-r border-[rgba(216,192,139,0.78)] bg-[rgba(255,251,239,0.98)] shadow-[0_24px_80px_rgba(113,88,40,0.12)]">
            <div className="border-b border-[rgba(216,192,139,0.76)] p-5">
              <Link href="/portal" className="inline-flex">
                <CerniqLockup compact tagline="Client Portal" />
              </Link>
              <div className="mt-4 rounded-[1.35rem] border border-[rgba(216,192,139,0.78)] bg-gradient-to-br from-[rgba(255,251,239,0.98)] via-[rgba(255,246,230,0.98)] to-[rgba(247,228,188,0.65)] px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-700/80">
                  Report delivery
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Submit balance-sheet files, track processing, and retrieve
                  completed CERNIQ reports.
                </p>
              </div>
            </div>

            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition ${
                      active
                        ? 'border border-cyan-200/80 bg-gradient-to-r from-cyan-50 to-sky-50 font-medium text-cyan-800 shadow-[0_12px_28px_rgba(34,211,238,0.12)]'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="space-y-1 border-t border-[rgba(216,192,139,0.76)] p-3">
              <a
                href="mailto:soporte@cerniq.io"
                className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
              >
                <HelpCircle className="h-4 w-4" />
                Get Help
              </a>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>

            {user && (
              <div className="border-t border-[rgba(216,192,139,0.76)] p-4">
                <p className="truncate text-xs text-slate-500">{user.email}</p>
                <p className="mt-0.5 text-[10px] capitalize text-slate-400">
                  {subscription?.tier || 'free'} plan
                </p>
              </div>
            )}
          </aside>

          <main className="flex-1 overflow-auto">
            <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-6xl">
                {showPortalPaywall && user ? (
                  <PortalPaywall
                    path={pathname}
                    subscription={subscription}
                    user={{ email: user.email, name: user.name }}
                  />
                ) : (
                  children
                )}
              </div>
            </div>
          </main>
        </div>
      </ErrorBoundary>
    </PortalContext.Provider>
  );
}
