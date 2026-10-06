'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface GARCHParams {
  readonly omega: number;
  readonly alpha: number;
  readonly beta: number;
  readonly persistence: number;
  readonly longRunVol: number;
  readonly halfLife: number;
}

interface GARCHForecastPoint {
  readonly horizon: number;
  readonly volatility: number;
  readonly annualizedVol: number;
}

interface GARCHHistoricalPoint {
  readonly date: string;
  readonly return_: number;
  readonly conditionalVol: number;
}

interface GARCHDiagnostics {
  readonly logLikelihood: number;
  readonly aic: number;
  readonly ljungBoxPValue: number;
  readonly observationCount: number;
}

interface GARCHResult {
  readonly params: GARCHParams;
  readonly currentVol: number;
  readonly forecasts: readonly GARCHForecastPoint[];
  readonly historicalVols: readonly GARCHHistoricalPoint[];
  readonly diagnostics: GARCHDiagnostics;
}

function validateGarch(raw: unknown): GARCHResult {
  if (!raw || typeof raw !== 'object') throw new Error('GARCH response must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.params || typeof r.params !== 'object') throw new Error('GARCH: missing params');
  if (typeof r.currentVol !== 'number') throw new Error('GARCH: missing currentVol');
  if (!Array.isArray(r.forecasts)) throw new Error('GARCH: forecasts must be array');
  return r as unknown as GARCHResult;
}

function getDemo(): GARCHResult {
  return {
    params: { omega: 0.0000012, alpha: 0.08, beta: 0.89, persistence: 0.97, longRunVol: 15.8, halfLife: 23 },
    currentVol: 14.2,
    forecasts: [
      { horizon: 1,   volatility: 0.0018, annualizedVol: 12.8 },
      { horizon: 5,   volatility: 0.0019, annualizedVol: 13.4 },
      { horizon: 21,  volatility: 0.0020, annualizedVol: 14.5 },
      { horizon: 63,  volatility: 0.0020, annualizedVol: 15.1 },
      { horizon: 252, volatility: 0.0020, annualizedVol: 15.8 },
    ],
    historicalVols: Array.from({ length: 60 }, (_, i) => ({
      date: `D-${60 - i}`,
      return_: (Math.sin(i * 0.3) * 1.5),
      conditionalVol: 12 + Math.sin(i * 0.15) * 3 + (i % 5) * 0.4,
    })),
    diagnostics: { logLikelihood: 245.3, aic: -484.6, ljungBoxPValue: 0.42, observationCount: 252 },
  };
}

interface ParamRow {
  readonly key: string;
  readonly symbol: string;
  readonly value: string;
  readonly desc: { en: string; es: string };
}

interface DiagRow {
  readonly key: string;
  readonly label: { en: string; es: string };
  readonly value: string;
  readonly ok?: boolean;
}

function GarchContent({ data }: { data: GARCHResult }) {
  const { locale } = useTranslation();
  const ljungBoxOk = data.diagnostics.ljungBoxPValue > 0.05;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'current_vol',   label: locale === 'es' ? 'Vol. Actual'      : 'Current Vol',     value: data.currentVol,          unit: '%' },
    { key: 'long_run_vol',  label: locale === 'es' ? 'Vol. Largo Plazo' : 'Long-Run Vol',    value: data.params.longRunVol,   unit: '%' },
    { key: 'persistence',   value: data.params.persistence, unit: 'x' },
    { key: 'half_life',     value: data.params.halfLife,    unit: 'days' },
    { key: 'aic',           label: 'AIC',                   value: data.diagnostics.aic, unit: 'x' },
    { key: 'ljung_box',     label: 'Ljung-Box p',           value: data.diagnostics.ljungBoxPValue, unit: 'x' },
  ], [data, locale]);

  const forecastChartData = useMemo(
    () => data.forecasts.map((f) => ({
      horizon: f.horizon === 1 ? '1D' : f.horizon === 5 ? '1W' : f.horizon === 21 ? '1M' : f.horizon === 63 ? '3M' : '1Y',
      vol: +f.annualizedVol.toFixed(1),
    })),
    [data],
  );

  const paramRows = useMemo<readonly ParamRow[]>(() => [
    { key: 'omega',  symbol: 'ω',      value: data.params.omega.toExponential(4), desc: { en: 'Variance intercept',       es: 'Intercepto varianza' } },
    { key: 'alpha',  symbol: 'α',      value: data.params.alpha.toFixed(4),       desc: { en: 'ARCH effect',              es: 'Efecto ARCH' } },
    { key: 'beta',   symbol: 'β',      value: data.params.beta.toFixed(4),        desc: { en: 'GARCH effect',             es: 'Efecto GARCH' } },
    { key: 'persistence', symbol: 'α + β', value: data.params.persistence.toFixed(4), desc: { en: 'Total persistence (< 1)', es: 'Persistencia total (< 1)' } },
    { key: 'half_life',   symbol: 't½',    value: `${data.params.halfLife.toFixed(0)} d`, desc: { en: 'Days for vol to halve', es: 'Días para vol/2' } },
  ], [data]);

  const paramColumns = useMemo<readonly DataTableColumn<ParamRow>[]>(() => [
    { id: 'sym',   header: '',                           kind: 'text', accessor: (r) => r.symbol,       width: 'w-10' },
    { id: 'name',  header: locale === 'es' ? 'Parámetro' : 'Parameter', kind: 'text', accessor: (r) => r.key },
    { id: 'desc',  header: locale === 'es' ? 'Descripción' : 'Description', kind: 'custom',
      accessor: (r) => r.desc[locale],
      render: (r) => <span className="text-[11px] text-slate-500">{r.desc[locale]}</span>,
      align: 'text-left',
    },
    { id: 'val',   header: locale === 'es' ? 'Valor' : 'Value',         kind: 'custom',
      accessor: (r) => r.value,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-slate-950">{r.value}</span>,
    },
  ], [locale]);

  const diagRows = useMemo<readonly DiagRow[]>(() => [
    { key: 'll',  label: { en: 'Log-Likelihood',    es: 'Log-Verosimilitud' }, value: data.diagnostics.logLikelihood.toFixed(1) },
    { key: 'aic', label: { en: 'AIC',               es: 'AIC' },               value: data.diagnostics.aic.toFixed(1) },
    { key: 'lb',  label: { en: 'Ljung-Box p-value', es: 'p-valor Ljung-Box' }, value: data.diagnostics.ljungBoxPValue.toFixed(3), ok: ljungBoxOk },
    { key: 'obs', label: { en: 'Observations',      es: 'Observaciones' },     value: String(data.diagnostics.observationCount) },
  ], [data, ljungBoxOk]);

  const diagColumns = useMemo<readonly DataTableColumn<DiagRow>[]>(() => [
    { id: 'label', header: locale === 'es' ? 'Diagnóstico' : 'Diagnostic', kind: 'custom',
      accessor: (r) => r.label[locale],
      render: (r) => <span className="text-xs text-slate-600">{r.label[locale]}</span>,
      align: 'text-left',
    },
    { id: 'val',   header: locale === 'es' ? 'Valor' : 'Value', kind: 'custom',
      accessor: (r) => r.value,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.ok === true ? 'text-emerald-700' : r.ok === false ? 'text-amber-700' : 'text-slate-950'}`}>
          {r.value}
        </span>
      ),
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Volatilidad Condicional Histórica' : 'Historical Conditional Volatility'}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.historicalVols as GARCHHistoricalPoint[]}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={9} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
              <Area
                type="monotone"
                dataKey="conditionalVol"
                name={locale === 'es' ? 'Vol Condicional' : 'Conditional Vol'}
                stroke="#f97316"
                fill="#fed7aa"
                fillOpacity={0.4}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Pronóstico por Horizonte' : 'Forecast by Horizon'}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={forecastChartData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis dataKey="horizon" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={['auto', 'auto']} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
              <Line
                type="monotone"
                dataKey="vol"
                name={locale === 'es' ? 'Vol Anualizada' : 'Annualized Vol'}
                stroke="#f97316"
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#f97316' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Parámetros GARCH(1,1)' : 'GARCH(1,1) Parameters'}
          </p>
          <DataTable rows={paramRows} columns={paramColumns} locale={locale} rowKey={(r) => r.key} />
        </section>
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Diagnósticos' : 'Diagnostics'}
          </p>
          <DataTable rows={diagRows} columns={diagColumns} locale={locale} rowKey={(r) => r.key} />
        </section>
      </div>
    </>
  );
}

export default function GARCHPage() {
  return (
    <AlmPage<GARCHResult>
      slug="garch"
      iconTint="amber"
      validate={validateGarch}
      getDemo={getDemo}
    >
      {(data) => <GarchContent data={data} />}
    </AlmPage>
  );
}
