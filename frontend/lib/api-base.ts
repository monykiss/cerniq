function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

const CONFIGURED_API_ORIGIN = trimTrailingSlashes(
  process.env.NEXT_PUBLIC_NODE_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    '',
);

function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

const BALANCE_SHEET_TEMPLATE_PATHS = {
  cooperativa: '/templates/cerniq-balance-sheet-v1.csv',
  generic: '/templates/cerniq-balance-sheet-generic-v1.csv',
} as const;

export function getConfiguredApiOrigin(): string {
  return CONFIGURED_API_ORIGIN;
}

export function getPublicApiBase(): string {
  return '';
}

export function getPublicApiUrl(path: string): string {
  return normalizePath(path);
}

/**
 * Absolute URL straight at the API origin, skipping the same-origin
 * `/api/*` rewrite in `next.config.ts`.
 *
 * Use this for **multipart/file uploads only**. A portal CSV upload routed
 * through the rewrite reached the backend with a 0-byte buffer, so multer
 * produced an empty file and `parseCSV` reported "CSV must have a header row
 * and at least one data row" — blaming the user's data for what was really a
 * dropped request body. Posting at the API origin removes that proxy hop.
 *
 * Safe because the upload authenticates with a bearer token rather than a
 * cookie: `ALLOWED_ORIGINS` already returns
 * `access-control-allow-origin: https://cerniq.io` with `Authorization` in
 * `access-control-allow-headers`, and the frontend CSP already lists
 * `https://api.example.com` under `connect-src`.
 *
 * Falls back to the relative path when no origin is configured (local dev,
 * where frontend and backend share an origin or the rewrite is the only way
 * through).
 */
export function getDirectApiUrl(path: string): string {
  const normalized = normalizePath(path);
  return CONFIGURED_API_ORIGIN
    ? `${CONFIGURED_API_ORIGIN}${normalized}`
    : normalized;
}

export function getBalanceSheetTemplateUrl(
  type: keyof typeof BALANCE_SHEET_TEMPLATE_PATHS = 'cooperativa',
): string {
  return BALANCE_SHEET_TEMPLATE_PATHS[type];
}
