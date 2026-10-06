'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface FTPSegment {
  readonly segment: string;
  readonly category: 'asset' | 'liability';
  readonly totalBalance: number;
  readonly weightedActualRate: number;
  readonly weightedFTPRate: number;
  readonly weightedSpread: number;
  readonly totalContribution: number;
  readonly instrumentCount: number;
}

interface FTPAnalysis {
  readonly segments: readonly FTPSegment[];
  readonly summary: {
    readonly totalAssetContribution: number;
    readonly totalLiabilityContribution: number;
    readonly netFTPMargin: number;
    readonly netFTPMarginPct: number;
    readonly totalAssets: number;
    readonly totalLiabilities: number;
    readonly weightedAssetSpread: number;
    readonly weightedLiabilitySpread: number;
  };
  readonly curveUsed: string;
  readonly asOfDate: string;
}

function validateFTP(raw: unknown): FTPAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('FTP response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.segments)) throw new Error('FTP: segments must be array');
  if (!r.summary || typeof r.summary !== 'object') throw new Error('FTP: missing summary');
  return r as unknown as FTPAnalysis;
}

function getDemo(): FTPAnalysis {
  return {
    segments: [
      { segment: 'commercial_re',        category: 'asset',     totalBalance: 120, weightedActualRate: 0.058, weightedFTPRate: 0.041, weightedSpread:  0.017, totalContribution:  2.040, instrumentCount: 3 },
      { segment: 'residential_mortgage', category: 'asset',     totalBalance:  95, weightedActualRate: 0.055, weightedFTPRate: 0.044, weightedSpread:  0.011, totalContribution:  1.045, instrumentCount: 2 },
      { segment: 'consumer_loans',       category: 'asset',     totalBalance:  85, weightedActualRate: 0.072, weightedFTPRate: 0.042, weightedSpread:  0.030, totalContribution:  2.550, instrumentCount: 4 },
      { segment: 'auto_loans',           category: 'asset',     totalBalance:  62, weightedActualRate: 0.065, weightedFTPRate: 0.041, weightedSpread:  0.024, totalContribution:  1.488, instrumentCount: 2 },
      { segment: 'securities',           category: 'asset',     totalBalance:  50, weightedActualRate: 0.042, weightedFTPRate: 0.042, weightedSpread:  0.000, totalContribution:  0.000, instrumentCount: 3 },
      { segment: 'demand_deposits',      category: 'liability', totalBalance: 180, weightedActualRate: 0.005, weightedFTPRate: 0.048, weightedSpread:  0.043, totalContribution:  7.740, instrumentCount: 2 },
      { segment: 'savings',              category: 'liability', totalBalance:  95, weightedActualRate: 0.015, weightedFTPRate: 0.046, weightedSpread:  0.031, totalContribution:  2.945, instrumentCount: 2 },
      { segment: 'time_deposits',        category: 'liability', totalBalance:  75, weightedActualRate: 0.040, weightedFTPRate: 0.042, weightedSpread:  0.002, totalContribution:  0.150, instrumentCount: 3 },
      { segment: 'borrowings',           category: 'liability', totalBalance:  35, weightedActualRate: 0.052, weightedFTPRate: 0.042, weightedSpread: -0.010, totalContribution: -0.350, instrumentCount: 1 },
    ],
    summary: {
      totalAssetContribution:     7.123,
      totalLiabilityContribution: 10.485,
      netFTPMargin:               17.608,
      netFTPMarginPct:            0.0427,
      totalAssets:                412,
      totalLiabilities:           385,
      weightedAssetSpread:        0.0173,
      weightedLiabilitySpread:    0.0272,
    },
    curveUsed:  'US Treasury (Default)',
    asOfDate:   new Date().toISOString(),
  };
}

function FTPContent({ data }: { data: FTPAnalysis }) {
  const { locale } = useTranslation();

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'asset_contribution',     label: locale === 'es' ? 'Contrib. Activos'  : 'Asset Contribution',     value: data.summary.totalAssetContribution,     unit: 'USD_M' },
    { key: 'liability_contribution', label: locale === 'es' ? 'Contrib. Pasivos'  : 'Liability Contribution', value: data.summary.totalLiabilityContribution, unit: 'USD_M' },
    { key: 'net_ftp_margin',         label: locale === 'es' ? 'Margen FTP Neto'   : 'Net FTP Margin',         value: data.summary.netFTPMargin,               unit: 'USD_M' },
    { key: 'net_ftp_margin_pct',     label: locale === 'es' ? 'Margen FTP %'      : 'Net FTP Margin %',       value: data.summary.netFTPMarginPct,            unit: 'ratio' },
    { key: 'asset_spread',           label: locale === 'es' ? 'Spread Activos'    : 'Asset Spread',           value: data.summary.weightedAssetSpread,        unit: 'ratio' },
    { key: 'liability_spread',       label: locale === 'es' ? 'Spread Pasivos'    : 'Liability Spread',       value: data.summary.weightedLiabilitySpread,    unit: 'ratio' },
  ], [data, locale]);

  const waterfallData = useMemo(
    () => data.segments.map((s) => ({
      name: s.segment.replace(/_/g, ' '),
      contribution: +s.totalContribution.toFixed(3),
      category: s.category,
    })),
    [data],
  );

  const columns = useMemo<readonly DataTableColumn<FTPSegment>[]>(() => [
    { id: 'segment',  header: locale === 'es' ? 'Segmento' : 'Segment', kind: 'custom',
      accessor: (r) => r.segment,
      render: (r) => <span className="text-xs font-medium capitalize text-slate-800">{r.segment.replace(/_/g, ' ')}</span>,
      align: 'text-left',
    },
    { id: 'category', header: locale === 'es' ? 'Tipo' : 'Type', kind: 'custom',
      accessor: (r) => r.category,
      render: (r) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          r.category === 'asset' ? 'bg-cyan-50 text-cyan-700' : 'bg-purple-50 text-purple-700'
        }`}>
          {r.category === 'asset' ? (locale === 'es' ? 'Activo' : 'Asset') : (locale === 'es' ? 'Pasivo' : 'Liability')}
        </span>
      ),
    },
    { id: 'balance',      header: locale === 'es' ? 'Balance'     : 'Balance',     kind: 'number', accessor: (r) => r.totalBalance,        unit: 'USD_M' },
    { id: 'actual_rate',  header: locale === 'es' ? 'Tasa Actual' : 'Actual Rate', kind: 'number', accessor: (r) => r.weightedActualRate,  unit: 'ratio' },
    { id: 'ftp_rate',     header: locale === 'es' ? 'Tasa FTP'    : 'FTP Rate',    kind: 'number', accessor: (r) => r.weightedFTPRate,     unit: 'ratio' },
    { id: 'spread_bps',   header: 'Spread bps', kind: 'custom',
      accessor: (r) => r.weightedSpread * 10000,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.weightedSpread >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {r.weightedSpread >= 0 ? '+' : ''}{(r.weightedSpread * 10000).toFixed(0)}
        </span>
      ),
    },
    { id: 'contribution', header: locale === 'es' ? 'Contribución' : 'Contribution', kind: 'delta',
      accessor: (r) => r.totalContribution, unit: 'USD_M' },
  ], [locale]);

  return (
    <>
      <div className="text-[11px] text-slate-500">
        {locale === 'es' ? 'Curva' : 'Curve'}: {data.curveUsed}
      </div>

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Waterfall chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Contribución FTP por Segmento' : 'FTP Contribution by Segment'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={waterfallData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0).toFixed(3)}M`, '']} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="contribution" radius={[4, 4, 0, 0]}>
              {waterfallData.map((entry) => (
                <Cell key={entry.name} fill={entry.contribution >= 0 ? '#059669' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Segment table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Descomposición FTP por Segmento' : 'FTP Decomposition by Segment'}
        </p>
        <DataTable rows={data.segments} columns={columns} locale={locale} rowKey={(r) => `${r.category}-${r.segment}`} />
      </section>
    </>
  );
}

export default function FTPPage() {
  return (
    <AlmPage<FTPAnalysis>
      slug="ftp"
      iconTint="amber"
      validate={validateFTP}
      getDemo={getDemo}
    >
      {(data) => <FTPContent data={data} />}
    </AlmPage>
  );
}
