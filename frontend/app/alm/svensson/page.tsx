'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { label } from '@/lib/alm/labels';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface SvenssonParams {
  readonly beta0: number;
  readonly beta1: number;
  readonly beta2: number;
  readonly lambda: number;
  readonly beta3: number;
  readonly lambda2: number;
}

interface NelsonSiegelParams {
  readonly beta0: number;
  readonly beta1: number;
  readonly beta2: number;
  readonly lambda: number;
}

interface CurvePoint {
  readonly tenor: number;
  readonly rate: number;
}

interface SvenssonResult {
  readonly svenssonParams: SvenssonParams;
  readonly nelsonSiegelParams: NelsonSiegelParams;
  readonly fittedCurve: readonly CurvePoint[];
  readonly baseCurve: readonly CurvePoint[];
  readonly comparison: {
    readonly nelsonSiegelRMSE: number;
    readonly svenssonRMSE: number;
    readonly improvementPct: number;
  };
}

function validateSvensson(raw: unknown): SvenssonResult {
  if (!raw || typeof raw !== 'object') throw new Error('Svensson response must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.svenssonParams || !r.nelsonSiegelParams) throw new Error('Svensson: missing params');
  if (!Array.isArray(r.baseCurve)) throw new Error('Svensson: baseCurve must be array');
  return r as unknown as SvenssonResult;
}

function getDemo(): SvenssonResult {
  const baseCurve = [
    { tenor: 0.25, rate: 0.048  }, { tenor: 0.5, rate: 0.0465 }, { tenor: 1,  rate: 0.044  },
    { tenor: 2,    rate: 0.042  }, { tenor: 3,   rate: 0.041  }, { tenor: 5,  rate: 0.0405 },
    { tenor: 7,    rate: 0.041  }, { tenor: 10,  rate: 0.042  }, { tenor: 20, rate: 0.0455 }, { tenor: 30, rate: 0.0465 },
  ];
  return {
    svenssonParams:     { beta0: 0.0471, beta1: -0.0015, beta2: -0.0082, lambda: 1.8, beta3: 0.0034, lambda2: 5.2 },
    nelsonSiegelParams: { beta0: 0.0468, beta1:  0.0012, beta2: -0.0095, lambda: 1.6 },
    fittedCurve: baseCurve.map((p, i) => ({ tenor: p.tenor, rate: p.rate + (i % 3 - 1) * 0.0001 })),
    baseCurve,
    comparison: { nelsonSiegelRMSE: 0.00042, svenssonRMSE: 0.00018, improvementPct: 57.1 },
  };
}

interface ParamRow {
  readonly key: string;
  readonly label: string;
  readonly svensson: number | null;
  readonly nelsonSiegel: number | null;
}

function SvenssonContent({ data }: { data: SvenssonResult }) {
  const { locale } = useTranslation();

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'svensson_rmse',  label: 'Svensson RMSE',       value: data.comparison.svenssonRMSE * 10000,     unit: 'bps' },
    { key: 'ns_rmse',        label: 'Nelson-Siegel RMSE',  value: data.comparison.nelsonSiegelRMSE * 10000, unit: 'bps' },
    { key: 'improvement',    label: locale === 'es' ? 'Mejora' : 'Improvement', value: data.comparison.improvementPct, unit: '%' },
    { key: 'svensson_params', label: locale === 'es' ? 'Parámetros Svensson' : 'Svensson Params', value: 6, unit: 'count' },
    { key: 'ns_params',       label: locale === 'es' ? 'Parámetros NS' : 'NS Params',             value: 4, unit: 'count' },
    { key: 'tenor_points',    label: locale === 'es' ? 'Puntos Tenor' : 'Tenor Points',           value: data.baseCurve.length, unit: 'count' },
  ], [data, locale]);

  const chartData = useMemo(
    () => data.baseCurve.map((p, i) => ({
      tenor: `${p.tenor}Y`,
      market: +(p.rate * 100).toFixed(3),
      svensson: +((data.fittedCurve[i]?.rate ?? 0) * 100).toFixed(3),
    })),
    [data],
  );

  const paramRows = useMemo<readonly ParamRow[]>(() => {
    const allKeys: (keyof SvenssonParams)[] = ['beta0', 'beta1', 'beta2', 'beta3', 'lambda', 'lambda2'];
    return allKeys.map((k) => ({
      key: k,
      label: label(k, locale),
      svensson: data.svenssonParams[k] ?? null,
      nelsonSiegel:
        (data.nelsonSiegelParams as unknown as Record<string, number | undefined>)[
          k
        ] ?? null,
    }));
  }, [data, locale]);

  const columns = useMemo<readonly DataTableColumn<ParamRow>[]>(() => [
    { id: 'name',     header: locale === 'es' ? 'Parámetro' : 'Parameter', kind: 'custom',
      accessor: (r) => r.label,
      render: (r) => <span className="text-xs text-slate-700">{r.label}</span>,
      align: 'text-left',
    },
    { id: 'svensson', header: 'Svensson',      kind: 'custom',
      accessor: (r) => r.svensson,
      render: (r) => r.svensson != null
        ? <span className="font-mono text-xs font-bold tabular-nums text-indigo-700">{r.svensson.toFixed(6)}</span>
        : <span className="text-xs text-slate-300">—</span>,
    },
    { id: 'ns',       header: 'Nelson-Siegel', kind: 'custom',
      accessor: (r) => r.nelsonSiegel,
      render: (r) => r.nelsonSiegel != null
        ? <span className="font-mono text-xs font-bold tabular-nums text-slate-600">{r.nelsonSiegel.toFixed(6)}</span>
        : <span className="text-xs text-slate-300">—</span>,
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Curve fit chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Ajuste de Curva: Mercado vs Svensson' : 'Curve Fit: Market vs Svensson'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(3)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="market"   name={locale === 'es' ? 'Mercado' : 'Market'} stroke="#475569" strokeWidth={2}                     dot={{ r: 4 }} />
            <Line type="monotone" dataKey="svensson" name="Svensson"                                stroke="#6366f1" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Parameter comparison table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Parámetros: Svensson vs Nelson-Siegel' : 'Parameters: Svensson vs Nelson-Siegel'}
        </p>
        <DataTable rows={paramRows} columns={columns} locale={locale} rowKey={(r) => r.key} />
      </section>
    </>
  );
}

export default function SvenssonPage() {
  return (
    <AlmPage<SvenssonResult>
      slug="svensson"
      iconTint="indigo"
      validate={validateSvensson}
      getDemo={getDemo}
    >
      {(data) => <SvenssonContent data={data} />}
    </AlmPage>
  );
}
