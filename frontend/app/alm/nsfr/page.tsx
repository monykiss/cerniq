'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface NSFRCategory {
  readonly category: string;
  readonly categoryEs: string;
  readonly balance: number;
  readonly factor: number;
  readonly weightedAmount: number;
}

interface NSFRRecommendation {
  readonly action: string;
  readonly actionEs: string;
  readonly impact: string;
  readonly impactEs: string;
}

interface NSFRResult {
  readonly nsfr: number;
  readonly status: 'compliant' | 'warning' | 'breach';
  readonly asf: { readonly total: number; readonly categories: readonly NSFRCategory[] };
  readonly rsf: { readonly total: number; readonly categories: readonly NSFRCategory[] };
  readonly surplus: number;
  readonly interpretation: string;
  readonly interpretationEs: string;
  readonly recommendations: readonly NSFRRecommendation[];
}

function validateNSFR(raw: unknown): NSFRResult {
  if (!raw || typeof raw !== 'object') throw new Error('NSFR response must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.nsfr !== 'number') throw new Error('NSFR: missing nsfr');
  if (!r.asf || !r.rsf) throw new Error('NSFR: missing asf/rsf');
  return r as unknown as NSFRResult;
}

function getDemo(): NSFRResult {
  return {
    nsfr: 112.4,
    status: 'compliant',
    surplus: 1_860_000_000,
    asf: {
      total: 16_850_000_000,
      categories: [
        { category: 'Regulatory Capital',     categoryEs: 'Capital Regulatorio',        balance:  1_740_000_000, factor: 1.00, weightedAmount:  1_740_000_000 },
        { category: 'Stable Deposits',        categoryEs: 'Depósitos Estables',          balance: 12_600_000_000, factor: 0.95, weightedAmount: 11_970_000_000 },
        { category: 'Less Stable Deposits',   categoryEs: 'Depósitos Menos Estables',    balance:  3_500_000_000, factor: 0.90, weightedAmount:  3_150_000_000 },
      ],
    },
    rsf: {
      total: 14_990_000_000,
      categories: [
        { category: 'Cash & Reserves',        categoryEs: 'Efectivo y Reservas',        balance:  1_890_000_000, factor: 0.00, weightedAmount:           0 },
        { category: 'Government Securities',  categoryEs: 'Valores Gubernamentales',    balance:  3_780_000_000, factor: 0.05, weightedAmount:   189_000_000 },
        { category: 'Performing Loans',       categoryEs: 'Préstamos Vigentes',         balance: 11_340_000_000, factor: 0.85, weightedAmount: 9_639_000_000 },
        { category: 'Mortgage Loans',         categoryEs: 'Préstamos Hipotecarios',     balance:  5_670_000_000, factor: 0.65, weightedAmount: 3_685_500_000 },
        { category: 'Fixed Assets',           categoryEs: 'Activos Fijos',              balance:  1_476_000_000, factor: 1.00, weightedAmount: 1_476_000_000 },
      ],
    },
    interpretation:    'NSFR of 112.4% exceeds the 100% minimum. Long-term assets are adequately funded by stable sources.',
    interpretationEs:  'NSFR de 112.4% excede el mínimo de 100%. Los activos de largo plazo están adecuadamente financiados por fuentes estables.',
    recommendations: [
      { action: 'Maintain core deposit growth above 3%', actionEs: 'Mantener crecimiento depósitos sobre 3%', impact: 'Preserves NSFR compliance buffer', impactEs: 'Preserva margen de cumplimiento NSFR' },
      { action: 'Review mortgage portfolio for securitization', actionEs: 'Revisar cartera hipotecaria para titulización', impact: 'Can reduce RSF by 65% of securitized amount', impactEs: 'Puede reducir RSF en 65% del monto titulizado' },
    ],
  };
}

function NSFRContent({ data }: { data: NSFRResult }) {
  const { locale } = useTranslation();

  const statusStyles = {
    compliant: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', Icon: CheckCircle2, label: locale === 'es' ? 'Cumple'      : 'Compliant' },
    warning:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   Icon: AlertTriangle, label: locale === 'es' ? 'Advertencia' : 'Warning' },
    breach:    { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    Icon: AlertTriangle, label: locale === 'es' ? 'Incumple'    : 'Breach' },
  }[data.status];
  const StatusIcon = statusStyles.Icon;

  // NSFR balances are in raw dollars — convert to millions for display.
  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'nsfr',    label: 'NSFR',                                     value: data.nsfr,                unit: '%' },
    { key: 'asf',     label: locale === 'es' ? 'ASF Total' : 'Total ASF', value: data.asf.total / 1_000_000, unit: 'USD_M' },
    { key: 'rsf',     label: locale === 'es' ? 'RSF Total' : 'Total RSF', value: data.rsf.total / 1_000_000, unit: 'USD_M' },
    { key: 'surplus', label: locale === 'es' ? 'Superávit' : 'Surplus',   value: data.surplus    / 1_000_000, unit: 'USD_M' },
    { key: 'asf_categories', label: locale === 'es' ? 'Cat. ASF' : 'ASF Categories', value: data.asf.categories.length, unit: 'count' },
    { key: 'rsf_categories', label: locale === 'es' ? 'Cat. RSF' : 'RSF Categories', value: data.rsf.categories.length, unit: 'count' },
  ], [data, locale]);

  const chartData = useMemo(() => [
    ...data.asf.categories.map((c) => ({
      name: locale === 'es' ? c.categoryEs : c.category,
      asf: c.weightedAmount / 1_000_000,
      rsf: 0,
    })),
    ...data.rsf.categories.map((c) => ({
      name: locale === 'es' ? c.categoryEs : c.category,
      asf: 0,
      rsf: c.weightedAmount / 1_000_000,
    })),
  ], [data, locale]);

  const categoryColumns = useMemo<readonly DataTableColumn<NSFRCategory>[]>(() => [
    { id: 'name', header: locale === 'es' ? 'Categoría' : 'Category', kind: 'custom',
      accessor: (r) => locale === 'es' ? r.categoryEs : r.category,
      render: (r) => <span className="text-xs font-medium text-slate-800">{locale === 'es' ? r.categoryEs : r.category}</span>,
      align: 'text-left',
    },
    { id: 'balance',  header: locale === 'es' ? 'Balance'  : 'Balance',   kind: 'custom',
      accessor: (r) => r.balance,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-600">${(r.balance / 1_000_000).toFixed(0)}M</span>,
    },
    { id: 'factor',   header: locale === 'es' ? 'Factor'   : 'Factor',    kind: 'number', accessor: (r) => r.factor, unit: 'ratio' },
    { id: 'weighted', header: locale === 'es' ? 'Ponderado' : 'Weighted', kind: 'custom',
      accessor: (r) => r.weightedAmount,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-slate-900">${(r.weightedAmount / 1_000_000).toFixed(0)}M</span>,
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Status banner */}
      <section className={`flex items-center gap-3 rounded-xl border p-4 ${statusStyles.bg} ${statusStyles.border}`}>
        <StatusIcon className={`h-5 w-5 ${statusStyles.text}`} />
        <div>
          <p className={`text-sm font-bold ${statusStyles.text}`}>{statusStyles.label}</p>
          <p className="text-xs text-slate-600">{locale === 'es' ? data.interpretationEs : data.interpretation}</p>
        </div>
      </section>

      {/* ASF vs RSF bar chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'ASF vs RSF por Categoría ($M)' : 'ASF vs RSF by Category ($M)'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}M`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={140} />
            <Tooltip formatter={(v) => `$${Number(v ?? 0).toFixed(0)}M`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="asf" name="ASF" fill="#0e7490" radius={[0, 4, 4, 0]} />
            <Bar dataKey="rsf" name="RSF" fill="#94a3b8" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ASF + RSF tables side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Desglose ASF' : 'ASF Breakdown'}
          </p>
          <DataTable rows={data.asf.categories} columns={categoryColumns} locale={locale} rowKey={(r) => r.category} />
        </section>
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Desglose RSF' : 'RSF Breakdown'}
          </p>
          <DataTable rows={data.rsf.categories} columns={categoryColumns} locale={locale} rowKey={(r) => r.category} />
        </section>
      </div>

      {/* Recommendations */}
      {data.recommendations.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Recomendaciones' : 'Recommendations'}
          </p>
          <div className="space-y-2">
            {data.recommendations.map((r, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-bold text-cyan-600">{i + 1}.</span>
                <div>
                  <p className="font-medium text-slate-800">{locale === 'es' ? r.actionEs : r.action}</p>
                  <p className="text-slate-500">{locale === 'es' ? r.impactEs : r.impact}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export default function NSFRPage() {
  return (
    <AlmPage<NSFRResult>
      slug="nsfr"
      iconTint="blue"
      validate={validateNSFR}
      getDemo={getDemo}
    >
      {(data) => <NSFRContent data={data} />}
    </AlmPage>
  );
}
