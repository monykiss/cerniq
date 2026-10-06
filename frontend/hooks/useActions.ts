'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-base';
import { getAccessToken } from '@/lib/api';

export interface ActionMeta {
  id: string;
  label: { en: string; es: string };
  module: string;
  description?: { en: string; es: string };
  requiresConfirm?: boolean;
  audit?: boolean;
  estimatedDurationMs?: number;
}

export interface ActionDispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  criticalGapCount?: number;
  warningGapCount?: number;
}

/**
 * useActions — fetches the action registry catalog and provides dispatch.
 *
 * The catalog is fetched lazily (call `load()` or set `autoLoad: true`).
 * Dispatch sends POST /api/actions/:id/dispatch with the given input.
 */
export function useActions(opts: { autoLoad?: boolean } = {}) {
  const [actions, setActions] = useState<ActionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getAccessToken() || null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getPublicApiUrl('/api/actions'), {
        credentials: 'include',
        headers,
      });
      if (!res.ok) throw new Error(`Failed to load actions: ${res.status}`);
      const data = await res.json();
      setActions(Array.isArray(data) ? data : data?.actions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts.autoLoad) void load();
  }, [opts.autoLoad, load]);

  const dispatch = useCallback(async (
    actionId: string,
    input: Record<string, unknown> = {},
  ): Promise<ActionDispatchResult> => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('capex_access_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(getPublicApiUrl(`/api/actions/${actionId}/dispatch`), {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: body?.message ?? `Dispatch failed: ${res.status}`,
        durationMs: 0,
      };
    }

    return res.json();
  }, []);

  return { actions, loading, error, load, dispatch };
}
