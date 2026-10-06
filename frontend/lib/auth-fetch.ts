/**
 * Authenticated `fetch` for call sites that don't go through `apiClient`.
 *
 * Why this exists — the Phase 4 auth sunset (`AUTH_DISABLE_LEGACY_MINT=true`)
 * routed every legacy HS256 mint through `AuthService.generateTokens`, which
 * now throws `410 Gone`. `setAuthCookies()` is called *after* that mint, so it
 * is unreachable in production: **no `access_token` cookie is ever issued.**
 *
 * `AuthGuard.extractToken` reads `cookies.access_token` first and falls back to
 * the `Authorization` header. With the cookie gone, a bare
 * `fetch(url, { credentials: 'include' })` carries no credential at all and 401s
 * — while `apiClient` kept working, because its request interceptor attaches
 * `Authorization: Bearer <sessionStorage token>`. That asymmetry silently broke
 * every hand-rolled fetch in the portal (overview load, CSV submit, exports).
 *
 * This helper gives those call sites the same credential apiClient uses.
 * `credentials: 'include'` is retained so a re-enabled cookie session keeps
 * working without touching call sites again.
 */
import { getAccessToken } from './api';
import { getConfiguredApiOrigin } from './api-base';
import { syncSupabaseAccessTokenToStorage } from './supabase/session';

function hasAuthorizationHeader(headers: Headers): boolean {
  return headers.has('Authorization') || headers.has('authorization');
}

/**
 * Only CerniQ-owned origins may receive the bearer token: the page's own
 * origin, plus the configured API origin (file uploads post straight at
 * `api.example.com` to avoid the rewrite hop that drops multipart bodies).
 *
 * Everything else is refused. Export download links can point at object
 * storage (R2 signed URLs); attaching the session token there would leak a
 * live credential to a third-party host and can invalidate the signature.
 * Mirrors the guard in `lib/document-exports.ts`.
 */
function isTrustedApiOrigin(input: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const url = new URL(input, window.location.origin);
    if (url.origin === window.location.origin) {
      return true;
    }

    const apiOrigin = getConfiguredApiOrigin();
    if (!apiOrigin) {
      return false;
    }

    return url.origin === new URL(apiOrigin, window.location.origin).origin;
  } catch {
    return false;
  }
}

/**
 * Resolve the bearer token, preferring the synchronous sessionStorage read that
 * `apiClient` uses. When that is empty the Supabase session is consulted — it
 * refreshes and re-syncs storage, which covers a token rotated in another tab
 * or an expiry crossed while the page sat idle.
 */
async function resolveBearerToken(): Promise<string> {
  // Resolving a credential must never throw: a failure here has to degrade to
  // an unauthenticated request so the caller surfaces the server's 401, rather
  // than bubbling out of `authFetch` and being mis-reported as a network error.
  try {
    const stored = getAccessToken();
    if (stored) {
      return stored;
    }

    return await syncSupabaseAccessTokenToStorage();
  } catch {
    return '';
  }
}

/**
 * Drop-in replacement for `fetch` on same-origin CerniQ API routes.
 *
 * Deliberately does NOT set `Content-Type`. Callers pass `FormData` for CSV
 * upload, and the browser must set `multipart/form-data` itself so the boundary
 * token matches the body.
 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!hasAuthorizationHeader(headers) && isTrustedApiOrigin(input)) {
    const token = await resolveBearerToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return fetch(input, {
    credentials: 'include',
    ...init,
    headers,
  });
}
