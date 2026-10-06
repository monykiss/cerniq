/**
 * CORS origin policy. Allowed origins are configuration only — FRONTEND_URL,
 * ALLOWED_ORIGINS and CORS_ORIGIN (comma-separated) — plus localhost outside
 * production. No production hostname is built in, so an unconfigured
 * deployment allows no cross-origin browser callers (fail closed).
 */

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function parseCsv(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * `ALLOW_PREVIEW_ORIGINS` gates CORS for preview deployments. The matching
 * pattern must be supplied explicitly via `VERCEL_PREVIEW_ORIGIN_REGEX`
 * (e.g. `^https://[a-z0-9-]+-your-team\.vercel\.app$`); there is no built-in
 * default, so a missing or invalid pattern allows no preview origins.
 *
 * - Production (cerniq.io): keep `false` — preview origins must not reach the
 *   live API with credentials.
 * - Demo / staging environments: set `true` so a preview build (or a demo URL
 *   served off a Vercel preview) can call the API with `credentials: include`.
 *   Pair with the cross-domain SameSite=none cookie (auto-detected in
 *   auth-cookie.util.ts) so the browser actually sends the cookie.
 *
 * Accepts `1|true|yes|on` (case-insensitive); anything else (incl. unset) = off.
 */
function allowPreviewOrigins(): boolean {
  const raw = (process.env.ALLOW_PREVIEW_ORIGINS || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getPreviewRegex(): RegExp | null {
  const configured = (process.env.VERCEL_PREVIEW_ORIGIN_REGEX || '').trim();
  if (!configured) {
    return null;
  }
  try {
    return new RegExp(configured, 'i');
  } catch (err) {
    console.warn(
      `[CORS] Invalid VERCEL_PREVIEW_ORIGIN_REGEX: "${configured}" — preview origins disabled`,
      err,
    );
    return null;
  }
}

function buildAllowedOriginsSet(): Set<string> {
  const origins = new Set<string>();
  const frontendUrl = normalizeOrigin((process.env.FRONTEND_URL || '').trim());
  if (frontendUrl) {
    origins.add(frontendUrl);
  }

  for (const origin of [
    ...parseCsv(process.env.ALLOWED_ORIGINS),
    ...parseCsv(process.env.CORS_ORIGIN),
  ]) {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }

  if (!isProduction()) {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
  }

  return origins;
}

export function isAllowedOrigin(
  origin: string | undefined | null,
  method?: string,
): boolean {
  if (!origin) {
    const m = (method || '').toUpperCase();
    const isMutating =
      m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
    if (isMutating && isProduction()) {
      return false;
    }
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  const staticAllowedOrigins = buildAllowedOriginsSet();
  if (staticAllowedOrigins.has(normalized)) {
    return true;
  }

  if (allowPreviewOrigins()) {
    const previewRegex = getPreviewRegex();
    if (previewRegex && previewRegex.test(normalized)) {
      return true;
    }
  }

  return false;
}

export function corsOriginCallback(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS origin not allowed: ${origin || 'unknown'}`), false);
}

export function corsOriginCallbackWithMethod(method: string) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    if (isAllowedOrigin(origin, method)) {
      callback(null, true);
      return;
    }
    callback(
      new Error(`CORS origin not allowed: ${origin || 'unknown'}`),
      false,
    );
  };
}
