'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, LineChart, Line,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface DepositBetaRow {
  readonly subcategory: string;
  readonly beta: number;
  readonly benchmark: number;
  readonly p25: number;
  readonly p75: number;
}

interface DepositBetaResult extends AlmDataShell {
  readonly institutionBetas: readonly DepositBetaRow[];
  // D1: null when there are no deposit products / rate history to calibrate.
  readonly niiImpact: {
    readonly withCalibrated: number;
    readonly withDefault: number;
    readonly difference: number;
  } | null;
  readonly libraryStats: {
    readonly institutions: number;
    readonly dateRange: string;
    readonly categories: number;
  } | null;
  readonly timeSeriesComparison: readonly {
    readonly period: string;
    readonly ffr: number;
    readonly savingsRate: number;
    readonly cdRate: number;
    readonly mmRate: number;
  }[];
}

function validateDepositBeta(raw: unknown): DepositBetaResult {
  if (!raw || typeof raw !== 'object') throw new Error('Deposit Beta response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null niiImpact + gaps[]); validate
  // STRUCTURE only — `institutionBetas` is the array the content maps over.
  if (!Array.isArray(r.institutionBetas)) throw new Error('Deposit Beta: institutionBetas must be array');
  return r as unknown as DepositBetaResult;
}

function getDemo(): DepositBetaResult {
  return {
    institutionBetas: [
      { subcategory: 'Demand Deposits',            beta: 0.08, benchmark: 0.12, p25: 0.05, p75: 0.18 },
      { subcategory: 'Regular Savings',            beta: 0.32, benchmark: 0.38, p25: 0.25, p75: 0.48 },
      { subcategory: 'Money Market',               beta: 0.55, benchmark: 0.52, p25: 0.40, p75: 0.65 },
      { subcategory: 'Share Certificates (CDs)',   beta: 0.78, benchmark: 0.82, p25: 0.70, p75: 0.90 },
      { subcategory: 'IRA Deposits',               beta: 0.65, benchmark: 0.60, p25: 0.50, p75: 0.72 },
      { subcategory: 'Club Accounts',              beta: 0.15, benchmark: 0.20, p25: 0.10, p75: 0.28 },
    ],
    niiImpact: { withCalibrated: 37.2, withDefault: 35.8, difference: 1.4 },
    libraryStats: { institutions: 94, dateRange: '2015-2024', categories: 6 },
    timeSeriesComparison: [
      { period: 'Q1 22', ffr: 0.25, savingsRate: 0.10, cdRate: 0.50, mmRate: 0.15 },
      { period: 'Q2 22', ffr: 1.25, savingsRate: 0.15, cdRate: 0.75, mmRate: 0.30 },
      { period: 'Q3 22', ffr: 2.50, savingsRate: 0.25, cdRate: 1.50, mmRate: 0.80 },
      { period: 'Q4 22', ffr: 4.00, savingsRate: 0.50, cdRate: 2.80, mmRate: 1.60 },
      { period: 'Q1 23', ffr: 4.75, savingsRate: 0.75, cdRate: 3.50, mmRate: 2.20 },
      { period: 'Q2 23', ffr: 5.00, savingsRate: 0.90, cdRate: 4.00, mmRate: 2.60 },
      { period: 'Q3 23', ffr: 5.25, savingsRate: 1.00, cdRate: 4.20, mmRate: 2.80 },
      { period: 'Q4 23', ffr: 5.25, savingsRate: 1.10, cdRate: 4.30, mmRate: 2.90 },
      { period: 'Q1 24', ffr: 5.25, savingsRate: 1.15, cdRate: 4.35, mmRate: 3.00 },
      { period: 'Q2 24', ffr: 5.25, savingsRate: 1.20, cdRate: 4.40, mmRate: 3.10 },
      { period: 'Q3 24', ffr: 5.00, savingsRate: 1.15, cdRate: 4.20, mmRate: 2.90 },
      { period: 'Q4 24', ffr: 4.75, savingsRate: 1.10, cdRate: 4.00, mmRate: 2.70 },
    ],
  };
}

function betaColor(b: number): string {
  if (b < 0.3) return '#059669';
  if (b < 0.6) return '#d97706';
  return '#dc2626';
}

function DepositBetaContent({ data }: { data: DepositBetaResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'nii_calibrated',    label: locale === 'es' ? 'NII Calibrado'    : 'NII Calibrated',  value: data.niiImpact?.withCalibrated ?? null, unit: 'USD_M' },
    { key: 'nii_default',       label: locale === 'es' ? 'NII Default'      : 'NII Default',     value: data.niiImpact?.withDefault ?? null,    unit: 'USD_M' },
    { key: 'nii_diff',          label: 'Δ NII',                                                  value: data.niiImpact?.difference ?? null,     unit: 'USD_M' },
    { key: 'pr_library',        label: locale === 'es' ? 'Biblioteca PR' : 'PR Library',         value: data.libraryStats?.institutions ?? null, unit: 'count' },
    { key: 'subcategory_count', label: locale === 'es' ? 'Subcategorías' : 'Subcategories',      value: data.institutionBetas.length,   unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<DepositBetaRow>[]>(() => [
    { id: 'category', header: locale === 'es' ? 'Categoría' : 'Category', kind: 'text', accessor: (r) => r.subcategory, align: 'text-left' },
    { id: 'beta',      header: locale === 'es' ? 'Tu Beta'   : 'Your Beta', kind: 'custom',
      accessor: (r) => r.beta,
      render: (r) => (
        <span className="font-mono text-xs font-bold tabular-nums" style={{ color: betaColor(r.beta) }}>
          {(r.beta * 100).toFixed(1)}%
        </span>
      ),
    },
    { id: 'benchmark', header: locale === 'es' ? 'Benchmark' : 'Benchmark', kind: 'number', accessor: (r) => r.benchmark, unit: 'ratio' },
    { id: 'p25',       header: 'P25',                                      kind: 'number', accessor: (r) => r.p25,       unit: 'ratio' },
    { id: 'p75',       header: 'P75',                                      kind: 'number', accessor: (r) => r.p75,       unit: 'ratio' },
    { id: 'status', header: locale === 'es' ? 'Estado' : 'Status', kind: 'custom',
      accessor: (r) => r.beta,
      align: 'text-center',
      render: (r) => {
        const tone =
          r.beta >= r.p25 && r.beta <= r.p75 ? { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'NORMAL' } :
          r.beta > r.p75                     ? { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'HIGH' } :
                                               { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'LOW' };
        return <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tone.bg} ${tone.text}`}>{tone.label}</span>;
      },
    },
  ], [locale]);

  // D1: no deposit products / rate history to calibrate → honest neutral panel.
  if (isDataUnavailable(data) || data.institutionBetas.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No deposit products are loaded. Load the deposit book (balances by product) to calibrate deposit betas against the Puerto Rico peer library.',
          es: 'No hay productos de depósito cargados. Cargue la cartera de depósitos (saldos por producto) para calibrar las betas de depósito contra la biblioteca de pares de Puerto Rico.',
        }}
      />
    );
  }

  return (
    <>
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {data.libraryStats ? (
        <div className="text-[11px] text-slate-500">
          {data.libraryStats.dateRange} · {data.libraryStats.institutions} {locale === 'es' ? 'instituciones' : 'institutions'} · {data.libraryStats.categories} {locale === 'es' ? 'categorías' : 'categories'}
        </div>
      ) : null}

      {/* Beta vs benchmark bar chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Beta por Subcategoría vs Benchmark PR' : 'Beta by Subcategory vs PR Benchmark'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.institutionBetas as DepositBetaRow[]} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <YAxis type="category" dataKey="subcategory" width={140} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="beta" name={locale === 'es' ? 'Tu Beta' : 'Your Beta'} radius={[0, 4, 4, 0]}>
              {data.institutionBetas.map((b) => <Cell key={b.subcategory} fill={betaColor(b.beta)} />)}
            </Bar>
            <Bar dataKey="benchmark" name={locale === 'es' ? 'Benchmark' : 'Benchmark'} fill="#94a3b8" radius={[0, 4, 4, 0]} opacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Pass-through time series */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Tasas de Depósito vs FFR (Pass-Through)' : 'Deposit Rates vs FFR (Pass-Through)'}
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data.timeSeriesComparison as DepositBetaResult['timeSeriesComparison']}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => `${Number(value ?? 0).toFixed(2)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="ffr"         name="Fed Funds"                              stroke="#0f172a" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="savingsRate" name={locale === 'es' ? 'Ahorros' : 'Savings'} stroke="#059669" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="cdRate"      name="CDs"                                     stroke="#d97706" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="mmRate"      name="Money Market"                            stroke="#6366f1" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Subcategory detail DataTable */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle por Subcategoría' : 'Subcategory Detail'}
        </p>
        <DataTable rows={data.institutionBetas} columns={columns} locale={locale} rowKey={(r) => r.subcategory} />
      </section>
    </>
  );
}

export default function DepositBetaPage() {
  return (
    <AlmPage<DepositBetaResult>
      slug="deposit-beta"
      iconTint="cyan"
      validate={validateDepositBeta}
      getDemo={getDemo}
    >
      {(data) => <DepositBetaContent data={data} />}
    </AlmPage>
  );
}
