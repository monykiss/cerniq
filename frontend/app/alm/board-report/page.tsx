'use client';

import { useMemo } from 'react';
import { Calendar } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { useALM } from '@/components/alm/ALMProvider';
import { AlmPage } from '@/components/alm/AlmPage';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';

import {
  validateBoardReport,
  buildBoardKpiTiles,
  countBoardGaps,
  urgencyTone,
  urgencyLabel,
  type BoardReportData,
  type BoardReportSection,
  type BoardReportRegPulseItem,
} from './board-report-helpers';

/**
 * Board Report — the package a cooperativa's junta directiva reads.
 *
 * Wires the D1-hardened endpoint `GET /api/alm/{id}/board-report`. The page
 * supplies NO `getDemo` fallback: a board package must never render fabricated
 * KPIs. Previously a `getDemo()` factory invented a full KPI set (NIM=3.5,
 * LCR=115, …) that any fetch failure would silently swap in — a director read
 * those numbers as their cooperativa's. They reflected nothing. Removed
 * 2026-06-07.
 *
 * The backend returns every KPI as `number | null` (NIM + NWR derived from real
 * data; the other six explicitly null + a WARNING gap each). Null KPIs render
 * as `—` with a "no disponible" hint — never `0`, never an invented value — and
 * <DataGapBanner> enumerates exactly which KPIs are still pending wiring so the
 * junta sees the full picture.
 */

interface SectionRow extends BoardReportSection {
  readonly index: number;
}

const URGENCY_TONE_CLASS: Record<
  ReturnType<typeof urgencyTone>,
  string
> = {
  high: 'border-rose-200 bg-rose-50 text-rose-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

function BoardReportContent({ data }: { readonly data: BoardReportData }) {
  const { locale } = useTranslation();
  const es = locale === 'es';

  const kpiTiles = useMemo(
    () => buildBoardKpiTiles(data.kpis, es),
    [data.kpis, es],
  );

  const gapCounts = useMemo(() => countBoardGaps(data.gaps), [data.gaps]);

  const sectionRows = useMemo<readonly SectionRow[]>(
    () => data.sections.map((s, index) => ({ ...s, index })),
    [data.sections],
  );

  const sectionColumns = useMemo<readonly DataTableColumn<SectionRow>[]>(
    () => [
      {
        id: 'num',
        header: '#',
        kind: 'text',
        accessor: (r) => String(r.index + 1),
        width: 'w-10',
      },
      {
        id: 'title',
        header: es ? 'Sección' : 'Section',
        kind: 'custom',
        accessor: (r) => (es ? r.titleEs : r.title),
        render: (r) => (
          <span className="text-xs font-medium text-slate-800">
            {es ? r.titleEs : r.title}
          </span>
        ),
        align: 'text-left',
      },
      {
        id: 'pages',
        header: es ? 'Páginas' : 'Pages',
        kind: 'custom',
        accessor: (r) => r.pageRange,
        render: (r) => (
          <span className="font-mono text-xs tabular-nums text-slate-600">
            p.{r.pageRange}
          </span>
        ),
      },
    ],
    [es],
  );

  const regPulseColumns = useMemo<
    readonly DataTableColumn<BoardReportRegPulseItem>[]
  >(
    () => [
      {
        id: 'deadline',
        header: es ? 'Plazo' : 'Deadline',
        kind: 'custom',
        accessor: (r) => (es ? r.deadlineEs : r.deadline),
        render: (r) => (
          <span className="inline-flex items-center gap-2 text-xs text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            {es ? r.deadlineEs : r.deadline}
          </span>
        ),
        align: 'text-left',
      },
      { id: 'date', header: es ? 'Fecha' : 'Date', kind: 'text', accessor: (r) => r.date },
      {
        id: 'urgency',
        header: es ? 'Urgencia' : 'Urgency',
        kind: 'custom',
        accessor: (r) => r.urgency,
        align: 'text-center',
        render: (r) => (
          <span
            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${URGENCY_TONE_CLASS[urgencyTone(r.urgency)]}`}
          >
            {urgencyLabel(r.urgency, es)}
          </span>
        ),
      },
    ],
    [es],
  );

  const topRisks = es ? data.topRisksEs : data.topRisks;
  const recommendations = es ? data.recommendationsEs : data.recommendations;

  return (
    <>
      {/* Institution + report context. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          {data.reportMonth} — {data.institutionName}
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
          {es ? 'CAMEL Compuesto' : 'CAMEL Composite'}:{' '}
          <span className="font-semibold text-slate-600">{data.camelComposite}</span>
        </div>
      </div>

      {/* D1: enumerate every missing KPI rather than papering over it. The
          junta sees exactly which numbers are real and which are pending. */}
      {data.gaps && data.gaps.length > 0 ? (
        <DataGapBanner
          gaps={data.gaps}
          criticalCount={gapCounts.critical}
          warningCount={gapCounts.warning}
        />
      ) : null}

      {/* KPI tiles. A null KPI renders as `—` + "no disponible" — never 0,
          never a fabricated number. */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {es ? 'Indicadores Clave' : 'Key Metrics'}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {kpiTiles.map((tile) => (
            <div
              key={tile.field}
              className={`rounded-xl border p-3 ${
                tile.available
                  ? 'border-slate-200 bg-white'
                  : 'border-dashed border-slate-200 bg-slate-50/60'
              }`}
            >
              <p
                className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                title={tile.label}
              >
                {tile.label}
              </p>
              <p
                className={`mt-1 tabular-nums text-lg font-bold ${
                  tile.available ? 'text-slate-900' : 'text-slate-300'
                }`}
              >
                {tile.display}
              </p>
              {!tile.available ? (
                <p className="text-[10px] italic text-slate-400">
                  {es ? 'no disponible' : 'not available'}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Top risks + recommended actions, from the real ALM summary. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
            {es ? 'Principales Riesgos' : 'Top Risks'}
          </p>
          <ul className="space-y-1.5">
            {topRisks.map((risk, i) => (
              <li key={i} className="text-xs text-rose-800">
                • {risk}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {es ? 'Acciones Recomendadas' : 'Recommended Actions'}
          </p>
          <ol className="space-y-1.5">
            {recommendations.map((rec, i) => (
              <li key={i} className="text-xs text-emerald-800">
                {i + 1}. {rec}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Report sections (table of contents of the bilingual PDF). */}
      {sectionRows.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {es ? 'Secciones del Informe' : 'Report Sections'}
          </p>
          <DataTable
            rows={sectionRows}
            columns={sectionColumns}
            locale={locale}
            rowKey={(r) => String(r.index)}
          />
        </section>
      ) : null}

      {/* Regulatory pulse. */}
      {data.regPulse.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {es ? 'Pulso Regulatorio' : 'Regulatory Pulse'}
          </p>
          <DataTable
            rows={data.regPulse}
            columns={regPulseColumns}
            locale={locale}
            rowKey={(r) => r.deadline}
          />
        </section>
      ) : null}
    </>
  );
}

function BoardReportControls() {
  const { selectedId } = useALM();
  if (!selectedId) return null;
  return (
    <DocumentExportButtons
      manifestPath={`/api/alm/${selectedId}/exports`}
      kinds={['alm_report']}
      compact
    />
  );
}

export default function BoardReportPage() {
  return (
    <AlmPage<BoardReportData>
      slug="board-report"
      iconTint="slate"
      validate={validateBoardReport}
      controls={<BoardReportControls />}
    >
      {(data) => <BoardReportContent data={data} />}
    </AlmPage>
  );
}
