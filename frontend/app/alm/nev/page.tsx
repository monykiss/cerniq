'use client';

import { useMemo, type ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n';
import { useALM } from '@/components/alm/ALMProvider';
import { AlmPage } from '@/components/alm/AlmPage';
import {
  MetricStrip,
  type MetricStripItem,
} from '@/components/density/MetricStrip';
import {
  DataTable,
  type DataTableColumn,
} from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';

import {
  validateNev,
  overallBanner,
  bandTone,
  bandLabel,
  formatShockLabel,
  formatNevMillions,
  formatPct,
  formatSensitivity,
  supervisoryShock,
  orderedShocks,
  isSupervisoryAnchor,
  anchorCellClass,
  institutionFraming,
  bandFootnote,
  type NevAnalysisResult,
  type NevShockPoint,
  type SemaforoTone,
} from './nev-helpers';

/**
 * NEV / EVE — the conclusion-first supervisory interest-rate-risk view.
 *
 * Wires the (previously backend-only) Layer 1 endpoint:
 *   - GET /api/alm/{id}/stress-test/nev
 *
 * Maps to BOTH the cooperativa (COSSEC) and banking (Basel IRRBB) worlds: the
 * measure is NEV / Valor Económico Neto for a credit union and EVE / Economic
 * Value of Equity for a bank — the same balance-sheet measure under two
 * regimes. The page leads with the regime that matches the selected
 * institution's type (`institutionFraming`) and shows the other as a
 * cross-reference, so a Presidente Ejecutivo and a banker both read it natively.
 *
 * No `getDemo` fallback is supplied: a supervisory artifact must never render
 * fabricated risk. The backend returns `overallRating: 'data_unavailable'` +
 * `baseNEV: null` + a `gaps[]` manifest for an empty balance sheet, which this
 * page renders honestly (gray semáforo + "cargue el balance" message + `—`,
 * never a `0` sentinel).
 */

const TONE_BG: Record<SemaforoTone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  gray: 'border-slate-200 bg-slate-50 text-slate-600',
};

const TONE_DOT: Record<SemaforoTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
};

/**
 * Wraps a shock-ladder cell so the +300bps supervisory-anchor row paints one
 * contiguous highlighted stripe (see `anchorCellClass`). `block` lets the
 * negative-margin bleed fill the `<td>`; inline content still honors the
 * column's text alignment.
 */
function AnchorCell({
  anchor,
  children,
}: {
  readonly anchor: boolean;
  readonly children: ReactNode;
}) {
  return <span className={anchorCellClass(anchor)}>{children}</span>;
}

function NevContent({ data }: { readonly data: NevAnalysisResult }) {
  const { locale } = useTranslation();
  const { institution } = useALM();
  const es = locale === 'es';

  // Type-aware supervisory framing: NEV/VEN/COSSEC for a cooperativa,
  // EVE/Basel IRRBB for a bank, with the other regime as a cross-reference.
  const framing = institutionFraming(institution?.type);
  const abbr = es ? framing.abbrEs : framing.abbrEn;
  const crossAbbr = es ? framing.crossAbbrEs : framing.crossAbbrEn;
  const measure = es ? framing.measureEs : framing.measureEn;
  const ratioLabel = es ? framing.ratioEs : framing.ratioEn;
  const regime = es ? framing.regimeEs : framing.regimeEn;
  const pb = es ? 'pb' : 'bps';

  const banner = overallBanner(data.overallRating);
  const anchor = useMemo(() => supervisoryShock(data.shocks), [data.shocks]);
  const ladder = useMemo(() => orderedShocks(data.shocks), [data.shocks]);
  const gapCounts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    for (const g of data.gaps ?? []) {
      if (g.severity === 'CRITICAL') critical += 1;
      else if (g.severity === 'WARNING') warning += 1;
    }
    return { critical, warning };
  }, [data.gaps]);

  // Numeric supervisory anchors. `null` flows through to NumberCell as `—`,
  // so the data_unavailable shape (no +300 shock, null base) reads honestly.
  const stripItems: readonly MetricStripItem[] = [
    {
      key: 'nev_ratio_300',
      label: `${ratioLabel} @ +300${pb}`,
      value: anchor?.nevRatio ?? null,
      unit: '%',
    },
    {
      key: 'nev_sens_300',
      label: `Δ${abbr} @ +300${pb}`,
      value: anchor ? Math.abs(anchor.nevChangePct) : null,
      unit: '%',
    },
    {
      key: 'base_nev',
      label: es ? `${abbr} Base` : `Base ${abbr}`,
      value: data.baseNEV,
      unit: 'USD_M',
    },
    {
      key: 'base_nev_ratio',
      label: es ? `${ratioLabel} Base` : `Base ${ratioLabel}`,
      value: data.baseNEVRatio,
      unit: '%',
    },
    {
      key: 'worst_ratio',
      label: es ? `Peor ${ratioLabel}` : `Worst ${ratioLabel}`,
      value: data.worstCase?.nevRatio ?? null,
      unit: '%',
    },
  ];

  const columns: readonly DataTableColumn<NevShockPoint>[] = [
    {
      id: 'shock',
      header: es ? 'Choque' : 'Shock',
      kind: 'custom',
      align: 'text-left',
      accessor: (s) => s.shockBps,
      render: (s) => {
        const isAnchor = isSupervisoryAnchor(s.shockBps);
        return (
          <AnchorCell anchor={isAnchor}>
            <span className="tabular-nums">{formatShockLabel(s.shockBps, es)}</span>
            {isAnchor ? (
              <span className="ml-2 rounded bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                {es ? 'Ancla supervisora' : 'Supervisory anchor'}
              </span>
            ) : null}
          </AnchorCell>
        );
      },
    },
    {
      id: 'nev',
      header: es ? `Valor ${abbr}` : `${abbr} Value`,
      kind: 'custom',
      align: 'text-right',
      accessor: (s) => s.nev,
      render: (s) => (
        <AnchorCell anchor={isSupervisoryAnchor(s.shockBps)}>
          <span className="tabular-nums">{formatNevMillions(s.nev)}</span>
        </AnchorCell>
      ),
    },
    {
      id: 'ratio',
      header: ratioLabel,
      kind: 'custom',
      align: 'text-right',
      accessor: (s) => s.nevRatio,
      render: (s) => (
        <AnchorCell anchor={isSupervisoryAnchor(s.shockBps)}>
          <span className="tabular-nums">{formatPct(s.nevRatio)}</span>
        </AnchorCell>
      ),
    },
    {
      id: 'sensitivity',
      header: es ? 'Sensibilidad' : 'Sensitivity',
      kind: 'custom',
      align: 'text-right',
      accessor: (s) => s.nevChangePct,
      render: (s) => (
        <AnchorCell anchor={isSupervisoryAnchor(s.shockBps)}>
          <span className="tabular-nums">{formatSensitivity(s.nevChangePct)}</span>
        </AnchorCell>
      ),
    },
    {
      id: 'band',
      header: es ? `Banda ${abbr}` : `${abbr} Band`,
      kind: 'custom',
      align: 'text-left',
      accessor: (s) => s.riskBand.level,
      render: (s) => {
        const tone = bandTone(s.riskBand.level);
        return (
          <AnchorCell anchor={isSupervisoryAnchor(s.shockBps)}>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`}
                aria-hidden
              />
              {bandLabel(s.riskBand.level, es)}
            </span>
          </AnchorCell>
        );
      },
    },
  ];

  return (
    <>
      {/* Conclusion-first semáforo banner: the supervisory verdict (worse-of
          ratio + sensitivity at +300bps) a Presidente Ejecutivo or banker reads
          in one glance, in their own regime's vocabulary. */}
      <section className={`rounded-xl border p-4 ${TONE_BG[banner.tone]}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${TONE_DOT[banner.tone]}`}
              aria-hidden
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
                {measure} ({abbr} ≡ {crossAbbr}) —{' '}
                {es ? 'Prueba Supervisora' : 'Supervisory Test'}
              </p>
              <p className="text-lg font-bold">{es ? banner.es : banner.en}</p>
              <p className="text-[10px] font-medium opacity-70">
                {regime} · {es ? 'ref.' : 'ref.'} {framing.crossRegime}
              </p>
            </div>
          </div>
          {anchor ? (
            <div className="text-right text-[11px] leading-tight opacity-80">
              <p className="font-semibold uppercase tracking-wide">
                {es ? 'Ancla +300pb' : '+300bps anchor'}
              </p>
              <p className="tabular-nums">
                {es ? 'Razón' : 'Ratio'} {abbr} {formatPct(anchor.nevRatio)} ·{' '}
                {es ? 'Sensib.' : 'Sens.'} {formatSensitivity(anchor.nevChangePct)}
              </p>
            </div>
          ) : (
            <div className="max-w-xs text-right text-[11px] leading-tight opacity-80">
              <p>
                {es
                  ? `Cargue el balance (activos y pasivos) y los segmentos para ejecutar la revaluación ${abbr}.`
                  : `Load the balance sheet (assets and liabilities) and segments to run the ${abbr} revaluation.`}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* D1: enumerate every missing input rather than papering over it. */}
      {data.gaps && data.gaps.length > 0 ? (
        <DataGapBanner
          gaps={data.gaps}
          criticalCount={gapCounts.critical}
          warningCount={gapCounts.warning}
        />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {es
            ? `Escalera de Choques ${abbr} (±100/200/300pb)`
            : `${abbr} Shock Ladder (±100/200/300bps)`}
        </p>
        {ladder.length > 0 ? (
          <>
            <DataTable
              rows={ladder}
              columns={columns}
              locale={locale}
              rowKey={(s) => String(s.shockBps)}
            />
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              {bandFootnote(framing, es)}
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            {es
              ? `No hay escalera de choques — cargue el balance de situación y los segmentos para revaluar el ${abbr} bajo ±100/200/300pb.`
              : `No shock ladder available — load the balance sheet and segments to revalue ${abbr} under ±100/200/300bps.`}
          </p>
        )}
      </section>
    </>
  );
}

export default function NevPage() {
  return (
    <AlmPage<NevAnalysisResult>
      slug="nev"
      iconTint="blue"
      validate={validateNev}
    >
      {(data) => <NevContent data={data} />}
    </AlmPage>
  );
}
