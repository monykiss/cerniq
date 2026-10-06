/**
 * Supabase session helpers for API bearer attachment.
 */
import { getSupabaseBrowserClient, isSupabaseAuthEnabled } from './client';

const ACCESS_TOKEN_KEY = 'cerniq_access_token';

export async function getSupabaseAccessToken(): Promise<string> {
  if (!isSupabaseAuthEnabled()) {
    return '';
  }
  const client = getSupabaseBrowserClient();
  if (!client) {
    return '';
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    return '';
  }
  return data.session.access_token;
}

export async function syncSupabaseAccessTokenToStorage(): Promise<string> {
  const token = await getSupabaseAccessToken();
  if (typeof window !== 'undefined') {
    if (token) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
  }
  return token;
}

export type SupabaseOAuthProvider = 'google' | 'github';

/**
 * Starts a Supabase-hosted OAuth handshake (Phase 4 auth unification).
 *
 * The legacy Nest routes (`/api/auth/google`, `/api/auth/github`) mint HS256
 * sessions through `AuthService.generateTokens`, which returns 410 Gone once
 * `AUTH_DISABLE_LEGACY_MINT` is set — and even a successful mint would be
 * rejected at verify while `AUTH_ALLOW_LEGACY=false`. Supabase is therefore the
 * only viable issuer in production, so OAuth must originate here.
 *
 * `redirectTo` must be registered in the Supabase project's allowed redirect
 * URLs, and the Supabase callback must be an authorized redirect URI on the
 * Google OAuth client.
 */
export async function signInWithSupabaseOAuth(
  provider: SupabaseOAuthProvider,
  redirectTo: string,
): Promise<void> {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase auth is not configured');
  }
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error) {
    throw new Error(error.message || 'Could not start Google sign-in');
  }
}

/**
 * Polls for a Supabase session after an OAuth redirect.
 *
 * The browser client is constructed with `detectSessionInUrl: true`, so it
 * exchanges the `?code=` (PKCE) on the callback URL for a session — but that
 * exchange is a network round-trip, so the session is not guaranteed to exist
 * on the first tick. Returns '' on timeout rather than throwing; callers treat
 * an empty token as "no session yet" and fall through to their own handling.
 */
export async function waitForSupabaseSession(
  timeoutMs = 6000,
  pollMs = 200,
): Promise<string> {
  if (!isSupabaseAuthEnabled()) {
    return '';
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = await syncSupabaseAccessTokenToStorage();
    if (token) {
      return token;
    }
    if (Date.now() + pollMs > deadline) {
      return '';
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * True when the current URL carries an OAuth handshake result that the Supabase
 * client still needs to exchange (`?code=` for PKCE, or a legacy implicit-flow
 * `#access_token=`). Used to decide whether to wait for the exchange.
 */
export function hasSupabaseOAuthCallbackParams(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const { search, hash } = window.location;
  return (
    /[?&]code=/.test(search) ||
    /[?&]error=/.test(search) ||
    /access_token=/.test(hash)
  );
}

export async function signInWithSupabasePassword(
  email: string,
  password: string,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase auth is not configured');
  }
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.session?.access_token || !data.user) {
    throw new Error(error?.message || 'Supabase sign-in failed');
  }
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, data.session.access_token);
  }
  return {
    accessToken: data.session.access_token,
    userId: data.user.id,
    email: data.user.email || email,
  };
}

export async function signOutSupabase(): Promise<void> {
  const client = getSupabaseBrowserClient();
  if (!client) return;
  await client.auth.signOut();
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}
