"use client";

import { useCallback, useState } from "react";
import { Building2, Loader2 } from "lucide-react";

import { apiClient } from "@/lib/api";
import { getStoredOrganizationId } from "@/lib/org-context";
import { useALM } from "@/components/alm/ALMProvider";
import type { Locale } from "@/lib/i18n";

/**
 * The empty state every ALM panel lands on when the workspace holds NO
 * institution.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ALMProvider` sets `selectedId = ''` when `getInstitutions()` returns an
 * empty list. `AlmPage` passes that straight into `useAlmEndpoint`, which
 * short-circuits with `kind: 'no-institution'`. The result: a workspace with
 * zero institutions renders EVERY analytics panel as a red "Could not load X —
 * No institution selected" box whose only affordance is Retry — and retrying
 * cannot help, because there is nothing to select.
 *
 * That is a dead end, not an error: the platform is working exactly as built,
 * it simply has no book to analyse yet. The backend has had an idempotent
 * seeder for this the whole time (`POST /api/alm/institutions/seed`); nothing
 * in the UI ever offered it. This is that affordance.
 *
 * Seeding stays an EXPLICIT user action, never automatic — the same boundary
 * `Member 360`'s "Seed demo members" button keeps. Demo data appearing on its
 * own would make it impossible to tell a seeded book from a real one.
 */
export function NoInstitutionPrompt({ locale }: { locale: Locale }) {
  const { refresh } = useALM();
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seed = useCallback(async () => {
    setSeeding(true);
    setError(null);
    try {
      const workspaceId = getStoredOrganizationId();
      if (!workspaceId) {
        // No org context means the session never resolved a workspace. Say so
        // rather than posting a request that would 403 with a vaguer message.
        setError(
          locale === "es"
            ? "No hay contexto de organización en esta sesión. Vuelva a iniciar sesión."
            : "No organization context on this session. Please sign in again.",
        );
        return;
      }
      await apiClient.seedDemoInstitution(workspaceId, "cooperativa");
      // Re-fetch so ALMProvider picks the new institution and every panel
      // re-runs against it.
      await refresh();
    } catch (err: unknown) {
      // Surface the real reason — a silent failure here looks identical to
      // "the button does nothing" (D1).
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }, [locale, refresh]);

  return (
    <div className="flex items-center justify-center py-16">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <Building2 className="mx-auto h-10 w-10 text-slate-400" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-slate-900">
          {locale === "es"
            ? "No hay institución en este espacio de trabajo"
            : "No institution in this workspace"}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {locale === "es"
            ? "Cada panel de análisis necesita una institución. Cargue un balance en el portal, o comience con una cooperativa de demostración."
            : "Every analytics panel needs an institution. Upload a balance sheet in the portal, or start with a demo cooperativa."}
        </p>
        <button
          type="button"
          onClick={seed}
          disabled={seeding}
          aria-busy={seeding}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {seeding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Building2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {seeding
            ? locale === "es"
              ? "Creando…"
              : "Creating…"
            : locale === "es"
              ? "Cargar cooperativa de demostración"
              : "Load demo cooperativa"}
        </button>
        {error ? (
          <p className="mt-3 text-xs text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
