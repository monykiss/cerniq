/**
 * URL utilities — validation, normalization, safe redirect check.
 * Helpers for handling URLs securely in API endpoints.
 */

/**
 * Validate that a string is a well-formed URL.
 */
export function isValidUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a URL: lowercase scheme and host, remove trailing slash,
 * remove default ports, sort query parameters.
 */
export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input);

    // Remove default ports
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }

    // Sort query parameters for consistency
    const params = new URLSearchParams(url.searchParams);
    const sortedParams = new URLSearchParams(
      [...params.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    url.search = sortedParams.toString() ? `?${sortedParams.toString()}` : '';

    // Remove trailing slash (except for root path)
    let result = url.toString();
    if (result.endsWith('/') && url.pathname !== '/') {
      result = result.slice(0, -1);
    }

    return result;
  } catch {
    return input;
  }
}

/**
 * Check if a redirect URL is safe (same origin or in allowed list).
 * Prevents open redirect vulnerabilities.
 */
export function isSafeRedirect(
  redirectUrl: string,
  allowedHosts: string[],
): boolean {
  // Relative URLs are always safe
  if (redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) {
    return true;
  }

  try {
    const url = new URL(redirectUrl);

    // Block javascript: and data: protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    return allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/**
 * Extract the domain (host without port) from a URL.
 */
export function extractDomain(input: string): string | null {
  try {
    return new URL(input).hostname;
  } catch {
    return null;
  }
}

/**
 * Build a URL with query parameters from an object.
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
