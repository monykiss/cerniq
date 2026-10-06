/**
 * Security response headers, applied by `next.config.ts` to every route.
 *
 * Kept host-agnostic: the API origin comes from `NEXT_PUBLIC_NODE_API_URL`
 * at build time rather than a hardcoded production hostname. When it is not
 * configured, only same-origin API calls (through the `/api/*` rewrite) are
 * permitted.
 */

function toOrigin(raw: string | undefined): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin: string): string {
  return origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export function buildContentSecurityPolicy(apiUrl?: string): string {
  const apiOrigin = toOrigin(apiUrl);
  const connectSrc = [
    "'self'",
    ...(apiOrigin ? [apiOrigin, toWebSocketOrigin(apiOrigin)] : []),
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.segment.io',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://us.i.posthog.com',
    'https://*.ingest.sentry.io',
  ];

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.segment.com https://*.googletagmanager.com https://*.google-analytics.com https://us.i.posthog.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
    'block-all-mixed-content',
  ].join('; ');
}

export function buildSecurityHeaders(
  apiUrl?: string,
): Array<{ key: string; value: string }> {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(apiUrl),
    },
  ];
}
