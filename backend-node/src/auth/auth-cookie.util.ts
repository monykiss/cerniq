const isProduction = process.env.NODE_ENV === 'production';

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const normalized = (raw || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

/**
 * Returns true when the frontend origin and backend origin live on different
 * hosts (e.g. cerniq.io vs api.example.com). In that scenario cookies must use
 * SameSite=none so the browser includes them on cross-origin requests.
 */
function isCrossDomain(): boolean {
  try {
    const frontendHost = new URL(resolveFrontendUrl()).hostname.toLowerCase();
    const backendUrl = (process.env.BACKEND_URL || '').trim();
    if (backendUrl) {
      const backendHost = new URL(backendUrl).hostname.toLowerCase();
      return frontendHost !== backendHost;
    }
    // No explicit BACKEND_URL — in production the frontend is typically on a
    // different host than the API, so assume cross-domain.
    return isProduction;
  } catch {
    return false;
  }
}

function resolveCookieSameSite(): 'lax' | 'strict' | 'none' {
  const configured = (process.env.AUTH_COOKIE_SAMESITE || '')
    .trim()
    .toLowerCase();

  if (
    configured === 'strict' ||
    configured === 'none' ||
    configured === 'lax'
  ) {
    return configured;
  }

  // Cross-domain production setup (e.g. cerniq.io → api.example.com) requires
  // SameSite=none so the browser sends cookies on cross-origin requests.
  if (isProduction && isCrossDomain()) {
    return 'none';
  }

  return 'lax';
}

function resolveCookieDomain(): string {
  const configured = (process.env.AUTH_COOKIE_DOMAIN || '').trim();
  if (configured) {
    return configured;
  }

  if (!isProduction) {
    return '';
  }

  try {
    const frontendUrl = new URL(resolveFrontendUrl());
    const hostname = frontendUrl.hostname.trim().toLowerCase();
    const labels = hostname.split('.').filter(Boolean);

    if (
      !hostname ||
      hostname === 'localhost' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      labels.length < 2
    ) {
      return '';
    }

    return `.${labels.slice(-2).join('.')}`;
  } catch {
    return '';
  }
}

export function resolveFrontendUrl(): string {
  const configured = (process.env.FRONTEND_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (configured) {
    return configured;
  }

  if (!isProduction) {
    return 'http://localhost:3001';
  }

  return 'https://cerniq.io';
}

export function sanitizeFrontendReturnUrl(
  value: string | undefined,
  fallback = '/dashboard',
): string {
  const trimmed = (value || '').trim();

  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  return trimmed;
}

export function buildFrontendAuthCallbackRedirect(
  returnUrl: string | undefined,
  fallback = '/dashboard',
): string {
  const frontendUrl = resolveFrontendUrl();
  const safeReturnUrl = sanitizeFrontendReturnUrl(returnUrl, fallback);

  return `${frontendUrl}/auth/callback?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
}

export function getAuthCookieOptions() {
  const cookieDomain = resolveCookieDomain();
  const sameSite = resolveCookieSameSite();

  // Browsers require Secure=true when SameSite=none. Force it on regardless
  // of the AUTH_COOKIE_SECURE env var to prevent silent cookie rejection.
  const secure =
    sameSite === 'none'
      ? true
      : parseBoolean(process.env.AUTH_COOKIE_SECURE, isProduction);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

const ACCESS_TOKEN_MAX_AGE = 24 * 60 * 60 * 1000; // 24h
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7d

export function setAuthCookies(
  res: {
    cookie: (
      name: string,
      value: string,
      options: Record<string, unknown>,
    ) => void;
  },
  accessToken: string,
  refreshToken: string,
) {
  const cookieOptions = getAuthCookieOptions();

  res.cookie('access_token', accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  res.cookie('refresh_token', refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

export function clearAuthCookies(res: {
  clearCookie: (name: string, options: Record<string, unknown>) => void;
}) {
  const cookieOptions = getAuthCookieOptions();

  res.clearCookie('access_token', cookieOptions);
  res.clearCookie('refresh_token', cookieOptions);
}
