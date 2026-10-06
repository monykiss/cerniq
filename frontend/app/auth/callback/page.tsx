'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import {
  buildLoginUrlForReturnUrl,
  sanitizePostAuthReturnUrl,
} from '@/lib/auth-redirect';
import {
  hasSupabaseOAuthCallbackParams,
  waitForSupabaseSession,
} from '@/lib/supabase/session';

const PROFILE_RESOLUTION_DELAYS_MS =
  process.env.NODE_ENV === 'test' ? [0, 1, 1] : [0, 350, 900];

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrateFromStorage = useAuthStore((state) => state.hydrateFromStorage);
  // Run the resolution routine exactly once per mount. This effect is
  // deliberately NOT gated on store fields (`initialized`, `isAuthenticated`,
  // `user`): reading them as dependencies made the effect tear down and re-run
  // every time `hydrateFromStorage` mutated the store mid-loop, which cancelled
  // the in-flight routine before it could reach the login fallback — an
  // infinite re-hydration loop. The routine drives its own hydration and always
  // terminates in exactly one redirect (returnUrl on success, login otherwise).
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;

    const returnUrl = sanitizePostAuthReturnUrl(searchParams.get('returnUrl'));
    let cancelled = false;

    const routeAuthenticatedUser = () => {
      const latestState = useAuthStore.getState();

      if (!latestState.isAuthenticated || !latestState.user?.id) {
        return false;
      }

      router.replace(returnUrl);
      return true;
    };

    void (async () => {
      // Supabase OAuth (Phase 4) lands here with a `?code=` that the browser
      // client exchanges for a session via `detectSessionInUrl`. That exchange
      // is a network round-trip, so we must wait for it before concluding the
      // user is unauthenticated — otherwise a valid Google sign-in would race
      // the retry loop and get bounced to /login.
      if (hasSupabaseOAuthCallbackParams()) {
        await waitForSupabaseSession();

        if (cancelled) {
          return;
        }
      }

      for (const delayMs of PROFILE_RESOLUTION_DELAYS_MS) {
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }

        if (cancelled) {
          return;
        }

        // A concurrent AuthInitializer hydrate may already have resolved the
        // session — check before spending another network round-trip.
        if (routeAuthenticatedUser()) {
          return;
        }

        await hydrateFromStorage();

        if (cancelled) {
          return;
        }

        if (routeAuthenticatedUser()) {
          return;
        }
      }

      if (!cancelled) {
        router.replace(buildLoginUrlForReturnUrl(returnUrl));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromStorage, router, searchParams]);

  return (
    <div className="cerniq-dashboard-page relative min-h-screen overflow-hidden text-[var(--dashboard-text-primary)]">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(216,192,139,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(216,192,139,0.18)_1px,transparent_1px)] bg-[size:140px_140px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(232,160,32,0.08),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(27,58,107,0.08),transparent_32%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.22),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/20 border-t-cyan-200" />
        <p className="text-sm text-[var(--dashboard-text-secondary)]">Completing sign in...</p>
      </div>
    </div>
  );
}
