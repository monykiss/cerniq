'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import {
  ACCESS_REQUIRED_ROUTE,
  hasPlatformAccess,
  isProtectedAppPath,
  requiresPaidAccessPath,
} from '@/lib/access';
import { APP_NAVIGATION_EVENT, buildLoginRedirectUrl } from '@/lib/api';

const AUTH_ROUTE_PREFIXES = [
  '/auth',
  '/dashboard',
  '/onboarding',
  '/portal',
  '/settings',
  '/alm',
  ACCESS_REQUIRED_ROUTE,
];

const ANONYMOUS_ENTRY_ROUTES = new Set([
  '/login',
  '/portal/login',
  '/signup',
]);

function hasStoredAuthHint() {
  if (typeof window === 'undefined') {
    return false;
  }

  return [
    sessionStorage.getItem('cerniq_access_token'),
    sessionStorage.getItem('capex_access_token'),
    localStorage.getItem('cerniq_access_token'),
    localStorage.getItem('capex_access_token'),
    localStorage.getItem('cerniq_auth_user'),
    localStorage.getItem('capex_auth_user'),
  ].some(Boolean);
}

function isAuthRelevantPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAnonymousEntryRoute(pathname: string | null) {
  return pathname ? ANONYMOUS_ENTRY_ROUTES.has(pathname) : false;
}

export default function AuthInitializer() {
  const pathname = usePathname();
  const router = useRouter();
  const initialized = useAuthStore((state) => state.initialized);
  const access = useAuthStore((state) => state.access);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrateFromStorage = useAuthStore((state) => state.hydrateFromStorage);
  const initializeAnonymous = useAuthStore(
    (state) => state.initializeAnonymous,
  );
  const scopeRef = useRef<'auth' | 'public' | null>(null);

  useLayoutEffect(() => {
    const hasStoredAuth = hasStoredAuthHint();
    const anonymousEntry = isAnonymousEntryRoute(pathname);
    const shouldHydrate =
      (isAuthRelevantPath(pathname) && !anonymousEntry) || hasStoredAuth;
    const nextScope = shouldHydrate ? 'auth' : 'public';
    const enteringNewScope = scopeRef.current !== nextScope;
    scopeRef.current = nextScope;

    if (!shouldHydrate) {
      if (enteringNewScope || !initialized) {
        initializeAnonymous();
      }
      return;
    }

    if (enteringNewScope || !initialized) {
      void hydrateFromStorage();
    }
  }, [pathname, initialized, hydrateFromStorage, initializeAnonymous]);

  useLayoutEffect(() => {
    if (
      !initialized ||
      !pathname ||
      isAnonymousEntryRoute(pathname) ||
      !isProtectedAppPath(pathname)
    ) {
      return;
    }

    if (!isAuthenticated) {
      if (pathname !== ACCESS_REQUIRED_ROUTE) {
        const search =
          typeof window !== 'undefined' ? window.location.search : '';
        router.replace(buildLoginRedirectUrl(pathname, search));
      }
      return;
    }

    if (
      access &&
      !hasPlatformAccess(access) &&
      requiresPaidAccessPath(pathname) &&
      pathname !== ACCESS_REQUIRED_ROUTE
    ) {
      router.replace(ACCESS_REQUIRED_ROUTE);
    }
  }, [pathname, initialized, isAuthenticated, access, router]);

  useEffect(() => {
    function handleAppNavigation(event: Event) {
      const detail = (
        event as CustomEvent<{ href?: string; replace?: boolean }>
      ).detail;
      if (!detail?.href) {
        return;
      }

      if (detail.replace === false) {
        router.push(detail.href);
        return;
      }

      router.replace(detail.href);
    }

    window.addEventListener(
      APP_NAVIGATION_EVENT,
      handleAppNavigation as EventListener,
    );
    return () => {
      window.removeEventListener(
        APP_NAVIGATION_EVENT,
        handleAppNavigation as EventListener,
      );
    };
  }, [router]);

  return null;
}
