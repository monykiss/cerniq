'use client';

import { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';

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
import { apiClient } from '@/lib/api';

import {
  validateCossec,
  overallBanner,
  ratioTone,
  ratioStatusLabel,
  formatRatioValue,
  countRatioStatuses,
  type CossecComplianceResult,
  type CossecRatio,
  type SemaforoTone,
} from './cossec-helpers';

/**
 * COSSEC Compliance — the conclusion-first regulatory view + push-button
 * examiner PDF.
 *
 * Wires the (previously backend-only) Layer 1 endpoints:
 *   - GET /api/alm/{id}/cossec-compliance   (the 12-ratio matrix, this page)
 *   - GET /api/alm/{id}/cossec-report/pdf   (the download button)
 *
 * No `getDemo` fallback is supplied: a regulatory artifact must never render
 * fabricated compliance. The backend now returns `data_unavailable` + a gaps
 * manifest for empty inputs, which this page renders honestly (gray semáforo +
 * "Datos pendientes" banner).
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

function CossecContent({ data }: { readonly data: CossecComplianceResult }) {
  const { locale } = useTranslation();
  const { selectedId } = useALM();
  const es = locale === 'es';

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [excelDownloadError, setExcelDownloadError] = useState<string | null>(
    null,
  );

  const banner = overallBanner(data.overallStatus);
  const counts = useMemo(
    () => countRatioStatuses(data.ratios),
    [data.ratios],
  );
  const gapCounts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    for (const g of data.gaps ?? []) {
      if (g.severity === 'CRITICAL') critical += 1;
      else if (g.severity === 'WARNING') warning += 1;
    }
    return { critical, warning };
  }, [data.gaps]);

  async function handleDownload() {
    if (!selectedId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await apiClient.downloadCossecReport(selectedId, es ? 'es' : 'en');
    } catch {
      setDownloadError(
        es
          ? 'No se pudo generar el informe. Intente de nuevo.'
          : 'Could not generate the report. Please try again.',
      );
    } finally {
      setDownloading(false);
    }
  }

  async function handleExcelDownload() {
    if (!selectedId) return;
    setExcelDownloading(true);
    setExcelDownloadError(null);
    try {
      await apiClient.downloadAlmExcel(selectedId, es ? 'es' : 'en');
    } catch {
      setExcelDownloadError(
        es
          ? 'No se pudo generar el libro Excel. Intente de nuevo.'
          : 'Could not generate the Excel workbook. Please try again.',
      );
    } finally {
      setExcelDownloading(false);
    }
  }

  const stripItems: readonly MetricStripItem[] = [
    {
      key: 'exam_readiness',
      label: es ? 'Preparación de Examen' : 'Exam Readiness',
      value: data.examReadinessScore,
      unit: 'count',
    },
    {
      key: 'pass',
      label: es ? 'Razones que Cumplen' : 'Ratios Passing',
      value: counts.pass,
      unit: 'count',
    },
    {
      key: 'warning',
      label: es ? 'Observaciones' : 'Observations',
      value: counts.warning,
      unit: 'count',
    },
    {
      key: 'fail',
      label: es ? 'No Cumplen' : 'Failing',
      value: counts.fail,
      unit: 'count',
    },
    {
      key: 'pending',
      label: es ? 'Datos Pendientes' : 'Data Pending',
      value: counts.unavailable,
      unit: 'count',
    },
  ];

  const columns: readonly DataTableColumn<CossecRatio>[] = [
    {
      id: 'name',
      header: es ? 'Razón' : 'Ratio',
      kind: 'custom',
      accessor: (r) => r.nameEs,
      render: (r) => (
        <span
          className="text-xs font-medium text-slate-800"
          title={es ? r.descriptionEs : r.description}
        >
          {es ? r.nameEs : r.name}
        </span>
      ),
    },
    {
      id: 'value',
      header: es ? 'Valor' : 'Value',
      kind: 'custom',
      accessor: (r) => r.value,
      render: (r) => (
        <span className="tabular-nums text-xs font-semibold text-slate-900">
          {formatRatioValue(r)}
        </span>
      ),
    },
    {
      id: 'threshold',
      header: es ? 'Umbral' : 'Threshold',
      kind: 'custom',
      accessor: (r) => r.threshold,
      render: (r) => (
        <span className="text-xs text-slate-500">{r.threshold}</span>
      ),
    },
    {
      id: 'status',
      header: es ? 'Estado' : 'Status',
      kind: 'custom',
      accessor: (r) => r.status,
      render: (r) => {
        const tone = ratioTone(r.status);
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <span
              className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`}
              aria-hidden
            />
            {ratioStatusLabel(r.status, es)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {/* Conclusion-first banner + the push-button report (the #1 artifact). */}
      <section className={`rounded-xl border p-4 ${TONE_BG[banner.tone]}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${TONE_DOT[banner.tone]}`}
              aria-hidden
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
                {es ? 'Estado General COSSEC' : 'Overall COSSEC Status'}
              </p>
              <p className="text-lg font-bold">{es ? banner.es : banner.en}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading || !selectedId}
                aria-busy={downloading}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" aria-hidden />
                {downloading
                  ? es
                    ? 'Generando…'
                    : 'Generating…'
                  : es
                    ? 'Descargar Informe COSSEC (PDF)'
                    : 'Download COSSEC Report (PDF)'}
              </button>
              <button
                type="button"
                onClick={handleExcelDownload}
                disabled={excelDownloading || !selectedId}
                aria-busy={excelDownloading}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
                {excelDownloading
                  ? es
                    ? 'Generando…'
                    : 'Generating…'
                  : es
                    ? 'Descargar Excel (.xls)'
                    : 'Download Excel (.xls)'}
              </button>
            </div>
            {downloadError ? (
              <p className="text-[11px] text-rose-600" role="alert">
                {downloadError}
              </p>
            ) : null}
            {excelDownloadError ? (
              <p className="text-[11px] text-rose-600" role="alert">
                {excelDownloadError}
              </p>
            ) : null}
          </div>
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
          {es ? 'Matriz de 12 Razones COSSEC' : 'COSSEC 12-Ratio Matrix'}
        </p>
        {data.ratios.length > 0 ? (
          <DataTable
            rows={data.ratios}
            columns={columns}
            locale={locale}
            rowKey={(r) => String(r.id)}
          />
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            {es
              ? 'No hay razones disponibles — cargue el balance de situación para calcular la matriz COSSEC.'
              : 'No ratios available — load the balance sheet to compute the COSSEC matrix.'}
          </p>
        )}
      </section>
    </>
  );
}

export default function CossecPage() {
  return (
    <AlmPage<CossecComplianceResult>
      slug="cossec"
      iconTint="emerald"
      validate={validateCossec}
    >
      {(data) => <CossecContent data={data} />}
    </AlmPage>
  );
}
