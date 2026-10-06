/**
 * OAuth callback/origin configuration.
 *
 * Deployment hostnames are configuration, never constants: callback URLs come
 * from GOOGLE_CALLBACK_URL / GITHUB_CALLBACK_URL, falling back to BACKEND_URL
 * (or the local dev API) when unset.
 */
const LOCAL_API_ORIGIN = 'http://localhost:3000';

function trimTrailingSlashes(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '');
}

function apiOrigin(env = process.env): string {
  return trimTrailingSlashes(env.BACKEND_URL) || LOCAL_API_ORIGIN;
}

export function resolveGoogleCallbackUrl(env = process.env): string {
  return (
    trimTrailingSlashes(env.GOOGLE_CALLBACK_URL) ||
    `${apiOrigin(env)}/api/auth/google/callback`
  );
}

export function resolveGithubCallbackUrl(env = process.env): string {
  return (
    trimTrailingSlashes(env.GITHUB_CALLBACK_URL) ||
    `${apiOrigin(env)}/api/auth/github/callback`
  );
}

export function getGoogleOAuthWarnings(env = process.env): string[] {
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === 'production';

  if (!isProd) {
    return warnings;
  }

  const frontendUrl = trimTrailingSlashes(env.FRONTEND_URL);
  const callbackUrl = trimTrailingSlashes(env.GOOGLE_CALLBACK_URL);
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();

  const googleConfigured = Boolean(
    clientId || clientSecret || callbackUrl || frontendUrl,
  );

  if (!googleConfigured) {
    return warnings;
  }

  if (!clientId) {
    warnings.push(
      'GOOGLE_CLIENT_ID not set — Google OAuth requests will fail with invalid_client.',
    );
  }

  if (!clientSecret) {
    warnings.push(
      'GOOGLE_CLIENT_SECRET not set — Google OAuth callback exchange will fail in production.',
    );
  }

  if (!callbackUrl) {
    warnings.push(
      `GOOGLE_CALLBACK_URL not set — falling back to "${resolveGoogleCallbackUrl(env)}".`,
    );
  } else if (!callbackUrl.startsWith('https://')) {
    warnings.push(
      `GOOGLE_CALLBACK_URL is "${callbackUrl}" — production callbacks must use https.`,
    );
  }

  if (!frontendUrl) {
    warnings.push(
      'FRONTEND_URL not set — post-login redirects cannot target the web app.',
    );
  }

  return warnings;
}
