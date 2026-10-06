'use client';

import { useMemo } from 'react';
import { Check, X, Download } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

/**
 * NCUA 5300 Call Report — D1-hardened.
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): NO `getDemo` fallback is
 * supplied — a FILED regulatory artifact (the NCUA 5300 Call Report) must never
 * render a fabricated sample. The former getDemo() invented $445M total assets
 * / a 13.5% NWR / 8 account-code field values that a preparer would read as
 * their cooperativa's real filing. The backend `ncua-5300.service` returns an
 * honest `overallStatus:'data_unavailable'` shell (empty fields, a CRITICAL
 * EMPTY_BALANCE_SHEET gap) on an unloaded balance sheet, which this page
 * renders as <AlmDataUnavailable> + the gap manifest — never a `0` Call Report.
 * A genuine network / 5xx error renders <AlmPage>'s error screen. Removed
 * getDemo 2026-06-08.
 */

interface Form5300Field {
  readonly accountCode: string;
  readonly label: string;
  readonly value: number;
  readonly schedule: string;
  readonly sourceField: string;
}

interface Form5300ValidationNotice {
  readonly code: string;
  readonly description: string;
}

interface Form5300Data extends AlmDataShell {
  readonly quarter: string;
  // D1: null when no charter is on file / the balance sheet is unloaded.
  readonly charterNumber: string | null;
  readonly fields: readonly Form5300Field[];
  readonly validationResult: {
    readonly valid: boolean;
    readonly errors: readonly Form5300ValidationNotice[];
    readonly warnings: readonly Form5300ValidationNotice[];
  };
  readonly summary: {
    readonly totalAssets: number;
    readonly totalLiabilities: number;
    readonly netWorth: number;
    readonly netWorthRatio: number;
    readonly totalLoans: number;
    readonly totalShares: number;
    readonly totalInvestments: number;
  };
}

function validateForm5300(raw: unknown): Form5300Data {
  if (!raw || typeof raw !== 'object') throw new Error('Form 5300 response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.fields)) throw new Error('Form 5300: fields must be array');
  if (!r.validationResult || !r.summary) throw new Error('Form 5300: missing validationResult or summary');
  return r as unknown as Form5300Data;
}

function Form5300Content({ data }: { data: Form5300Data }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const vr = data.validationResult;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'total_assets',     label: locale === 'es' ? 'Activos'    : 'Total Assets',     value: data.summary.totalAssets,     unit: 'USD_M' },
    { key: 'total_liabilities',label: locale === 'es' ? 'Pasivos'    : 'Total Liabilities', value: data.summary.totalLiabilities, unit: 'USD_M' },
    { key: 'net_worth',        label: locale === 'es' ? 'Capital'    : 'Net Worth',         value: data.summary.netWorth,         unit: 'USD_M' },
    { key: 'nwr',              label: 'NWR',                                                 value: data.summary.netWorthRatio,    unit: '%' },
    { key: 'total_loans',      label: locale === 'es' ? 'Préstamos'  : 'Total Loans',        value: data.summary.totalLoans,       unit: 'USD_M' },
    { key: 'total_shares',     label: locale === 'es' ? 'Aportaciones' : 'Total Shares',     value: data.summary.totalShares,      unit: 'USD_M' },
    { key: 'field_count',      label: locale === 'es' ? 'Campos'     : 'Fields',            value: data.fields.length,            unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<Form5300Field>[]>(() => [
    { id: 'code',     header: locale === 'es' ? 'Código' : 'Code', kind: 'custom',
      accessor: (r) => r.accountCode,
      render: (r) => <span className="font-mono text-xs text-slate-600">{r.accountCode}</span>,
      align: 'text-left',
    },
    { id: 'label',    header: locale === 'es' ? 'Descripción' : 'Label', kind: 'text', accessor: (r) => r.label, align: 'text-left' },
    { id: 'value',    header: locale === 'es' ? 'Valor' : 'Value',        kind: 'number', accessor: (r) => r.value, unit: 'USD_M' },
    { id: 'schedule', header: 'Sched',                                    kind: 'text',   accessor: (r) => r.schedule },
    { id: 'source',   header: locale === 'es' ? 'Fuente' : 'Source', kind: 'custom',
      accessor: (r) => r.sourceField,
      render: (r) => <span className="font-mono text-[10px] text-slate-400">{r.sourceField}</span>,
      align: 'text-left',
    },
  ], [locale]);

  // D1: balance sheet not loaded → honest neutral panel + the CRITICAL gap,
  // never a fabricated Call Report. The backend shells `overallStatus`.
  if (isDataUnavailable(data)) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No balance sheet is loaded. Load it before generating the NCUA 5300 Call Report — filing against phantom data is a regulatory exposure.',
          es: 'No hay balance de situación cargado. Cárguelo antes de generar el Informe NCUA 5300 — radicar con datos ficticios es una exposición regulatoria.',
        }}
      />
    );
  }

  return (
    <>
      {/* D1: partial (status:'ok') WARNING gaps render alongside the filing. */}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <div className="text-[11px] text-slate-500">
        {locale === 'es' ? 'Trimestre' : 'Quarter'}: <strong>{data.quarter}</strong> · Charter: <strong>{data.charterNumber ?? '—'}</strong>
      </div>

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Validation banner */}
      <section className={`flex items-center gap-3 rounded-xl border p-4 ${
        vr.valid ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
      }`}>
        {vr.valid ? <Check className="h-6 w-6 text-emerald-600" /> : <X className="h-6 w-6 text-rose-600" />}
        <div className="flex-1">
          <p className={`text-sm font-bold ${vr.valid ? 'text-emerald-700' : 'text-rose-700'}`}>
            {vr.valid
              ? (locale === 'es' ? 'Validación Aprobada' : 'Validation Passed')
              : (locale === 'es' ? 'Errores de Validación' : 'Validation Errors')}
          </p>
          <p className="text-xs text-slate-600">
            {vr.errors.length} {locale === 'es' ? 'errores' : 'errors'}, {vr.warnings.length} {locale === 'es' ? 'advertencias' : 'warnings'}
          </p>
        </div>
      </section>

      {/* Warnings list (if any) */}
      {vr.warnings.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            {locale === 'es' ? 'Advertencias' : 'Warnings'}
          </p>
          <ul className="space-y-1">
            {vr.warnings.map((w) => (
              <li key={w.code} className="text-xs text-amber-800">
                <span className="font-mono font-bold">{w.code}</span> — {w.description}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Fields table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          NCUA 5300 {locale === 'es' ? 'Campos' : 'Fields'} ({data.fields.length})
        </p>
        <DataTable rows={data.fields} columns={columns} locale={locale} rowKey={(r) => r.accountCode} />
      </section>
    </>
  );
}

export default function Form5300Page() {
  const { locale } = useTranslation();
  return (
    <AlmPage<Form5300Data>
      slug="form-5300"
      iconTint="sky"
      validate={validateForm5300}
      controls={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
          >
            <Download className="h-3.5 w-3.5" />
            XML
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
          >
            <Download className="h-3.5 w-3.5" />
            {locale === 'es' ? 'PDF' : 'PDF'}
          </button>
        </div>
      }
    >
      {(data) => <Form5300Content data={data} />}
    </AlmPage>
  );
}
