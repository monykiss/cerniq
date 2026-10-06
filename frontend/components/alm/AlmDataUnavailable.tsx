'use client';

import { useTranslation } from '@/lib/i18n';
import { useReportDataGaps, type DataGap } from '@/hooks/useReportDataGaps';
import { DataGapBanner } from '@/components/ui/cerniq';

/**
 * AlmDataUnavailable — the neutral "DATA UNAVAILABLE" content state.
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): when a backend ALM service
 * returns a `data_unavailable` shell (it could not compute the result from the
 * institution's loaded inputs), the page renders THIS instead of either a grid
 * of fabricated demo numbers (the old `getDemo` path) or a misleading wall of
 * `0`s. It states plainly that data is missing and surfaces the backend's
 * `gaps[]` manifest — each missing input, its severity, and the action that
 * fixes it — via the same `<DataGapBanner>` used across the swept regulatory
 * pages (cossec / nev / board-report).
 *
 * Spanish-first: a Presidente Ejecutivo reads "DATOS INSUFICIENTES" as a
 * neutral, gray state — never a pass, never a breach.
 */

export interface AlmDataUnavailableProps {
  /** The backend gap manifest (`result.gaps`). */
  readonly gaps?: DataGap[];
  /**
   * Optional domain-specific lead line. Defaults to a generic bilingual
   * "not enough data to compute this analysis" message.
   */
  readonly message?: { readonly en: string; readonly es: string };
  readonly className?: string;
}

export function AlmDataUnavailable({
  gaps,
  message,
  className,
}: AlmDataUnavailableProps) {
  const { locale } = useTranslation();
  const es = locale === 'es';
  const { gaps: manifest, criticalCount, warningCount } =
    useReportDataGaps(gaps);

  const lead = message
    ? es
      ? message.es
      : message.en
    : es
      ? 'No hay datos suficientes para calcular este análisis. Cargue los insumos requeridos para ver resultados en vivo.'
      : 'There is not enough data to compute this analysis. Load the required inputs to see live results.';

  return (
    <div className={className ?? 'space-y-4'}>
      <section
        className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-md flex-col items-center gap-2">
          <span
            className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-400"
            aria-hidden
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {es ? 'Datos Insuficientes' : 'Data Unavailable'}
          </p>
          <p className="text-sm text-slate-600">{lead}</p>
        </div>
      </section>

      {/* The honest manifest — every missing input + the action that fixes it. */}
      {manifest.length > 0 ? (
        <DataGapBanner
          gaps={manifest}
          criticalCount={criticalCount}
          warningCount={warningCount}
        />
      ) : null}
    </div>
  );
}
