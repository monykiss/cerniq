'use client';

/**
 * useCurrentOrg — resolves the logged-in user's organization for the
 * Close Cockpit (and any other cockpit-style feature).
 *
 * Behavior:
 *   1. GET /api/organizations — returns every org the user is a member of.
 *   2. Selection is persisted in localStorage under 'cerniq:current_org_id'
 *      so the cockpit survives reloads.
 *   3. If the user has exactly one org (the common case for cooperativas),
 *      it auto-selects without asking.
 *   4. If the user has none (not yet onboarded), returns `orgId: null` so
 *      the caller can render an onboarding empty state.
 *
 * Why a bespoke hook rather than a context: we only need this on a
 * handful of surfaces and there's no shared state coupling. Adding a
 * provider would make the dependency graph heavier for zero benefit.
 */

import { useCallback, useEffect, useState } from 'react';
import { getPublicApiBase } from '@/lib/api-base';
import {
  getStoredOrganizationId,
  setStoredOrganizationId,
} from '@/lib/org-context';

const API_BASE = getPublicApiBase();

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

export interface UseCurrentOrgResult {
  orgs: OrgSummary[];
  orgId: string | null;
  setOrgId: (id: string) => void;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCurrentOrg(): UseCurrentOrgResult {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(() => {
    const stored = getStoredOrganizationId();
    return stored || null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/organizations`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Failed to load organizations: ${res.status}`);
      }
      const body = (await res.json()) as unknown;
      // Backend returns `{ data: Organization[] }` via the api-response envelope.
      const rawList = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown }).data)
          ? ((body as { data: unknown[] }).data as unknown[])
          : [];
      const list: OrgSummary[] = rawList
        .map((o) => {
          const org = o as Record<string, unknown>;
          return {
            id: typeof org.id === 'string' ? org.id : '',
            name: typeof org.name === 'string' ? org.name : '',
            slug: typeof org.slug === 'string' ? org.slug : '',
          };
        })
        .filter((o) => o.id);
      setOrgs(list);

      // Auto-select: (1) keep the stored ID if it still matches something
      // in the list; (2) otherwise pick the first org; (3) otherwise null.
      const stored = getStoredOrganizationId() || null;
      const valid = list.find((o) => o.id === stored);
      const next = valid?.id ?? list[0]?.id ?? null;
      setOrgIdState(next);
      setStoredOrganizationId(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
  }, [fetchOnce]);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    setStoredOrganizationId(id);
  }, []);

  return { orgs, orgId, setOrgId, loading, error, refetch: fetchOnce };
}
