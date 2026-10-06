'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-base';
import { authFetch } from '@/lib/auth-fetch';
import { unwrapApiData } from '@/lib/api-response';
import type { PortalOverview } from '@/lib/portal-overview';

export function usePortalOverview(enabled = true) {
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!enabled) {
      setOverview(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(getPublicApiUrl('/api/portal/overview'), {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Your session expired. Sign in again to load the portal.'
            : 'Could not load portal overview.',
        );
      }
      const payload = unwrapApiData<PortalOverview | null>(
        await res.json().catch(() => null),
      );
      setOverview(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load portal overview.',
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return {
    overview,
    loading,
    error,
    loadOverview,
    setOverview,
  };
}
