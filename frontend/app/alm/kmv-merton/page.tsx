'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface KMVObligor {
  readonly name: string;
  readonly assetValue: number;
  readonly debtPoint: number;
  readonly dd: number;
  readonly edf: number;
  readonly rating: string;
}

interface KMVResult extends AlmDataShell {
  // D1: null when there is no obligor portfolio to compute distance-to-default.
  readonly portfolioDD: number | null;
  readonly portfolioEDF: number | null;
  readonly riskRating: string | null;
  readonly obligors: readonly KMVObligor[];
}

function validateKMV(raw: unknown): KMVResult {
  if (!raw || typeof raw !== 'object') throw new Error('KMV response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null portfolioDD + gaps[]); validate
  // STRUCTURE only — `obligors` is the array the content maps over.
  if (!Array.isArray(r.obligors)) throw new Error('KMV: obligors must be array');
  return r as unknown as KMVResult;
}

function getDemo(): KMVResult {
  return {
    portfolioDD: 3.42,
    portfolioEDF: 0.0031,
    riskRating: 'A-',
    obligors: [
      { name: 'Consumer RE Pool',   assetValue: 95, debtPoint: 72, dd: 4.1, edf: 0.0002,  rating: 'A+' },
      { name: 'Commercial CRE',     assetValue: 68, debtPoint: 55, dd: 2.8, edf: 0.0026,  rating: 'BBB+' },
      { name: 'Auto Loan Pool',     assetValue: 42, debtPoint: 38, dd: 1.9, edf: 0.029,   rating: 'BB+' },
      { name: 'Small Business',     assetValue: 25, debtPoint: 22, dd: 1.5, edf: 0.067,   rating: 'BB-' },
      { name: 'Personal Unsecured', assetValue: 18, debtPoint: 16, dd: 1.1, edf: 0.136,   rating: 'B+' },
      { name: 'Municipal Bonds',    assetValue: 35, debtPoint: 12, dd: 5.2, edf: 0.00001, rating: 'AA' },
    ],
  };
}

function ddColor(dd: number): string {
  if (dd > 3) return '#059669';
  if (dd > 2) return '#d97706';
  if (dd > 1) return '#ea580c';
  return '#dc2626';
}

function ddLabel(dd: number, locale: 'en' | 'es'): string {
  if (dd > 3) return locale === 'es' ? 'Seguro'    : 'Safe';
  if (dd > 2) return locale === 'es' ? 'Vigilancia' : 'Watch';
  if (dd > 1) return locale === 'es' ? 'Advertencia' : 'Warning';
  return locale === 'es' ? 'Crítico' : 'Critical';
}

function KMVContent({ data }: { data: KMVResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'portfolio_dd',  label: locale === 'es' ? 'DD Portafolio'  : 'Portfolio DD',  value: data.portfolioDD,  unit: 'x' },
    { key: 'portfolio_edf', label: locale === 'es' ? 'EDF Portafolio' : 'Portfolio EDF', value: data.portfolioEDF, unit: 'ratio' },
    { key: 'risk_rating',   label: locale === 'es' ? 'Calificación'   : 'Risk Rating',   value: null, unit: undefined, /* string value rendered separately */ },
    { key: 'obligor_count', label: locale === 'es' ? 'Obligados'      : 'Obligors',      value: data.obligors.length, unit: 'count' },
    { key: 'safe_count',    label: locale === 'es' ? 'Seguros'        : 'Safe (DD>3)',   value: data.obligors.filter((o) => o.dd > 3).length, unit: 'count' },
    { key: 'critical_count',label: locale === 'es' ? 'Críticos'       : 'Critical (DD<1)', value: data.obligors.filter((o) => o.dd < 1).length, unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<KMVObligor>[]>(() => [
    { id: 'name', header: locale === 'es' ? 'Obligado' : 'Obligor', kind: 'text', accessor: (r) => r.name },
    { id: 'assets', header: locale === 'es' ? 'Activos' : 'Assets', kind: 'number', accessor: (r) => r.assetValue, unit: 'USD_M' },
    { id: 'debt',   header: locale === 'es' ? 'Deuda'   : 'Debt Point', kind: 'number', accessor: (r) => r.debtPoint, unit: 'USD_M' },
    { id: 'dd',
      header: 'DD',
      kind: 'custom',
      accessor: (r) => r.dd,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ddColor(r.dd) }} aria-hidden />
          <span className="font-mono text-xs font-bold tabular-nums" style={{ color: ddColor(r.dd) }}>
            {r.dd.toFixed(2)}
          </span>
        </span>
      ),
    },
    { id: 'edf',    header: 'EDF',    kind: 'number', accessor: (r) => r.edf, unit: 'ratio' },
    { id: 'rating', header: locale === 'es' ? 'Calif.' : 'Rating', kind: 'text', accessor: (r) => r.rating },
    { id: 'status', header: locale === 'es' ? 'Estado' : 'Status', kind: 'custom',
      accessor: (r) => ddLabel(r.dd, locale),
      render: (r) => (
        <span className="rounded-full border px-2 py-0.5 text-[9px] font-semibold" style={{
          color: ddColor(r.dd),
          borderColor: ddColor(r.dd) + '40',
          backgroundColor: ddColor(r.dd) + '10',
        }}>
          {ddLabel(r.dd, locale)}
        </span>
      ),
    },
  ], [locale]);

  // D1: no obligor portfolio loaded → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.obligors.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No obligor portfolio is loaded. Load borrower asset values and debt points to compute the KMV-Merton distance-to-default.',
          es: 'No hay una cartera de obligados cargada. Cargue los valores de activos y puntos de deuda de los prestatarios para calcular la distancia al incumplimiento (KMV-Merton).',
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

      {/* Extra line for the string-valued risk rating since MetricStrip is number-first */}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.08em] text-slate-500">
          {locale === 'es' ? 'Calificación Portafolio' : 'Portfolio Rating'}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold text-slate-700">
          {data.riskRating ?? '—'}
        </span>
      </div>

      {/* DD bar chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Distancia al Incumplimiento por Obligado' : 'Distance to Default by Obligor'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.obligors as KMVObligor[]} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11 }} domain={[0, 6]} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => [Number(value ?? 0).toFixed(2), 'DD']}
            />
            <Bar dataKey="dd" name="Distance-to-Default" radius={[0, 4, 4, 0]}>
              {data.obligors.map((o) => <Cell key={o.name} fill={ddColor(o.dd)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex justify-center gap-4 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> DD &gt; 3</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500"   /> DD 2–3</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500"  /> DD 1–2</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600"     /> DD &lt; 1</span>
        </div>
      </section>

      {/* Obligor detail table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle de Obligados' : 'Obligor Detail'}
        </p>
        <DataTable rows={data.obligors} columns={columns} locale={locale} rowKey={(r) => r.name} />
      </section>
    </>
  );
}

export default function KMVMertonPage() {
  return (
    <AlmPage<KMVResult>
      slug="kmv-merton"
      iconTint="amber"
      validate={validateKMV}
      getDemo={getDemo}
    >
      {(data) => <KMVContent data={data} />}
    </AlmPage>
  );
}
