const DEFAULT_POST_AUTH_RETURN_URL = '/dashboard';

export function sanitizePostAuthReturnUrl(
  value: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_RETURN_URL,
): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  return trimmed;
}

export function isWorkspaceReturnUrl(value: string | null | undefined): boolean {
  const safeReturnUrl = sanitizePostAuthReturnUrl(value, '');

  return (
    safeReturnUrl === '/dashboard' ||
    safeReturnUrl.startsWith('/dashboard/') ||
    safeReturnUrl === '/portal' ||
    safeReturnUrl.startsWith('/portal/')
  );
}

export function buildLoginUrlForReturnUrl(
  value: string | null | undefined,
  options?: {
    billingSuccess?: boolean;
    forceMagicLink?: boolean;
  },
): string {
  const safeReturnUrl = sanitizePostAuthReturnUrl(value);
  const params = new URLSearchParams({
    returnUrl: safeReturnUrl,
  });

  if (options?.forceMagicLink || isWorkspaceReturnUrl(safeReturnUrl)) {
    params.set('mode', 'magic-link');
  }

  if (options?.billingSuccess) {
    params.set('billing', 'success');
  }

  return `/login?${params.toString()}`;
}

export function buildAuthCallbackUrl(
  value: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_RETURN_URL,
): string {
  const safeReturnUrl = sanitizePostAuthReturnUrl(value, fallback);

  return `/auth/callback?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
}

export { DEFAULT_POST_AUTH_RETURN_URL };
export { isWorkspaceReturnUrl as isPortalReturnUrl };
