'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface RateRec {
  readonly product: string;
  readonly category: string;
  readonly currentRate: number;
  readonly peerMedianRate: number;
  readonly suggestedRate: number;
  readonly rateDeltaBps: number;
  readonly direction: string;
  readonly niiImpact: number;
  readonly volumeImpact: string;
  readonly rationale: string;
  readonly rationaleEs: string;
}

interface NIMResult extends AlmDataShell {
  // D1: null when there is no balance sheet / peer rate data to optimize.
  readonly currentNIM: number | null;
  readonly projectedNIM: number | null;
  readonly nimGainBps: number | null;
  readonly totalNIIGain: number | null;
  readonly recommendations: readonly RateRec[];
}

function validateNimOpt(raw: unknown): NIMResult {
  if (!raw || typeof raw !== 'object') throw new Error('NIM optimizer response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null currentNIM + gaps[]); validate
  // STRUCTURE only — `recommendations` is the array the content maps over.
  if (!Array.isArray(r.recommendations)) throw new Error('NIM opt: recommendations must be array');
  return r as unknown as NIMResult;
}

function getDemo(): NIMResult {
  return {
    currentNIM: 3.42,
    projectedNIM: 3.68,
    nimGainBps: 26,
    totalNIIGain: 4.8, // USD_M
    recommendations: [
      { product: 'Auto Loans',         category: 'Lending',  currentRate: 6.25, peerMedianRate: 6.85, suggestedRate: 6.75, rateDeltaBps:  50, direction: 'up',   niiImpact: 1.2, volumeImpact: 'Minimal',  rationale: 'Below peer median by 60bps with strong demand', rationaleEs: 'Por debajo de la mediana de pares por 60bps con demanda fuerte' },
      { product: 'Personal Loans',     category: 'Lending',  currentRate: 9.50, peerMedianRate: 10.15, suggestedRate: 9.95, rateDeltaBps: 45, direction: 'up',   niiImpact: 0.85, volumeImpact: 'Low',      rationale: 'Competitive gap allows 45bps increase',       rationaleEs: 'Brecha competitiva permite aumento de 45bps' },
      { product: 'Share Certificates', category: 'Deposits', currentRate: 4.75, peerMedianRate: 4.40, suggestedRate: 4.50, rateDeltaBps: -25, direction: 'down', niiImpact: 1.1, volumeImpact: 'Moderate', rationale: 'Above peer median; reduce to capture spread', rationaleEs: 'Sobre la mediana; reducir para capturar margen' },
      { product: 'Money Market',       category: 'Deposits', currentRate: 3.90, peerMedianRate: 3.65, suggestedRate: 3.70, rateDeltaBps: -20, direction: 'down', niiImpact: 0.65, volumeImpact: 'Low',      rationale: 'Slightly above median with stable balances',  rationaleEs: 'Ligeramente sobre mediana con saldos estables' },
      { product: 'Commercial RE',      category: 'Lending',  currentRate: 7.10, peerMedianRate: 7.45, suggestedRate: 7.35, rateDeltaBps:  25, direction: 'up',   niiImpact: 1.0, volumeImpact: 'Minimal',  rationale: 'Strong collateral supports higher rate',       rationaleEs: 'Colateral fuerte soporta tasa mayor' },
    ],
  };
}

function NimOptContent({ data }: { data: NIMResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'nim_current',    label: locale === 'es' ? 'NIM Actual'     : 'NIM Current',     value: data.currentNIM,   unit: '%' },
    { key: 'nim_projected',  label: locale === 'es' ? 'NIM Proyectado' : 'NIM Projected',   value: data.projectedNIM, unit: '%' },
    { key: 'nim_gain_bps',   label: locale === 'es' ? 'Ganancia NIM'   : 'NIM Gain',        value: data.nimGainBps,   unit: 'bps' },
    { key: 'total_nii_gain', label: locale === 'es' ? 'NII Adicional'  : 'Total NII Gain',  value: data.totalNIIGain, unit: 'USD_M' },
    { key: 'rec_count',      label: locale === 'es' ? 'Recomendaciones' : 'Recommendations', value: data.recommendations.length, unit: 'count' },
  ], [data, locale]);

  const chartData = useMemo(
    () => data.recommendations.map((r) => ({ name: r.product, impact: r.niiImpact })),
    [data],
  );

  const columns = useMemo<readonly DataTableColumn<RateRec>[]>(() => [
    { id: 'dir', header: '', kind: 'custom',
      accessor: (r) => r.direction,
      width: 'w-8',
      render: (r) => (
        r.direction === 'up'   ? <ArrowUp   className="inline h-4 w-4 text-emerald-600" aria-label="Up" /> :
        r.direction === 'down' ? <ArrowDown className="inline h-4 w-4 text-cyan-600"    aria-label="Down" /> :
                                 <Minus     className="inline h-4 w-4 text-slate-400"   aria-label="Flat" />
      ),
    },
    { id: 'product', header: locale === 'es' ? 'Producto' : 'Product', kind: 'custom',
      accessor: (r) => r.product,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
          {r.product}
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
            r.category === 'Lending' ? 'bg-cyan-50 text-cyan-700' : 'bg-purple-50 text-purple-700'
          }`}>
            {r.category}
          </span>
        </span>
      ),
      align: 'text-left',
    },
    { id: 'current',   header: locale === 'es' ? 'Actual'    : 'Current',   kind: 'number', accessor: (r) => r.currentRate,    unit: '%' },
    { id: 'peer',      header: locale === 'es' ? 'Pares'     : 'Peer Med.', kind: 'number', accessor: (r) => r.peerMedianRate, unit: '%' },
    { id: 'suggested', header: locale === 'es' ? 'Sugerido' : 'Suggested',  kind: 'number', accessor: (r) => r.suggestedRate,  unit: '%' },
    { id: 'delta',     header: 'Δ',                                         kind: 'delta',  accessor: (r) => r.rateDeltaBps,   unit: 'bps' },
    { id: 'impact',    header: locale === 'es' ? 'Impacto NII' : 'NII Impact', kind: 'delta', accessor: (r) => r.niiImpact, unit: 'USD_M' },
  ], [locale]);

  // D1: no balance sheet / peer rate data to optimize → honest neutral panel.
  if (isDataUnavailable(data) || data.recommendations.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'NIM optimization needs the product-level rate book and peer benchmarks. Load them to generate repricing recommendations.',
          es: 'La optimización del NIM requiere el libro de tasas por producto y los comparables de pares. Cárguelos para generar recomendaciones de repreciación.',
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

      {/* NII impact chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Impacto NII por Producto' : 'NII Impact by Product'}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, '']} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="impact" radius={[4, 4, 0, 0]}>
              {chartData.map((e) => (
                <Cell key={e.name} fill={e.impact >= 0 ? '#059669' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Recommendations table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Recomendaciones de Tasa' : 'Rate Recommendations'}
        </p>
        <DataTable rows={data.recommendations} columns={columns} locale={locale} rowKey={(r) => r.product} />
      </section>

      {/* Rationale cards */}
      <section className="space-y-2">
        {data.recommendations.map((r) => (
          <div key={r.product} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="mb-0.5 text-xs font-semibold text-slate-800">{r.product}</p>
            <p className="text-[11px] leading-relaxed text-slate-600">{locale === 'es' ? r.rationaleEs : r.rationale}</p>
          </div>
        ))}
      </section>
    </>
  );
}

export default function NIMOptimizerPage() {
  return (
    <AlmPage<NIMResult>
      slug="nim-optimizer"
      iconTint="emerald"
      validate={validateNimOpt}
      getDemo={getDemo}
    >
      {(data) => <NimOptContent data={data} />}
    </AlmPage>
  );
}
