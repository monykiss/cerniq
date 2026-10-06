'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface PortfolioKRDPoint {
  readonly tenor: string;
  readonly tenorYears: number;
  readonly krd: number;
}

interface InstrumentKRDDetail {
  readonly instrumentName: string;
  readonly balance: number;
  readonly modifiedDuration: number;
  readonly effectiveDuration: number;
  readonly convexity: number;
}

interface KeyRateDurationData extends AlmDataShell {
  readonly instruments: readonly InstrumentKRDDetail[];
  // D1: null when there is no fixed-income book to compute durations.
  readonly portfolioModifiedDuration: number | null;
  readonly portfolioEffectiveDuration: number | null;
  readonly portfolioConvexity: number | null;
  readonly durationGap: number | null;
  readonly negativeConvexityExposure: number | null;
  readonly portfolioKRDs: readonly PortfolioKRDPoint[];
}

function validateKRD(raw: unknown): KeyRateDurationData {
  if (!raw || typeof raw !== 'object') throw new Error('KRD response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null durations + gaps[]); validate
  // STRUCTURE only — `portfolioKRDs` is the array the content maps over.
  if (!Array.isArray(r.portfolioKRDs)) throw new Error('KRD: portfolioKRDs must be array');
  return r as unknown as KeyRateDurationData;
}

function getDemo(): KeyRateDurationData {
  return {
    instruments: [
      { instrumentName: 'Agency MBS 15Y', balance: 85,  modifiedDuration: 5.2, effectiveDuration: 4.1, convexity: -2.1 },
      { instrumentName: 'UST 10Y',        balance: 45,  modifiedDuration: 8.4, effectiveDuration: 8.4, convexity:  0.7 },
      { instrumentName: 'Corporate IG 5Y',balance: 62,  modifiedDuration: 4.1, effectiveDuration: 4.0, convexity:  0.3 },
      { instrumentName: 'UST 2Y',         balance: 38,  modifiedDuration: 1.9, effectiveDuration: 1.9, convexity:  0.1 },
      { instrumentName: 'Muni 7Y',        balance: 22,  modifiedDuration: 6.1, effectiveDuration: 5.8, convexity:  0.4 },
    ],
    portfolioModifiedDuration: 4.2,
    portfolioEffectiveDuration: 3.8,
    portfolioConvexity: -0.6,
    durationGap: 2.1,
    negativeConvexityExposure: 50,
    portfolioKRDs: [
      { tenor: '3M',  tenorYears: 0.25, krd: 0.12 },
      { tenor: '1Y',  tenorYears: 1,    krd: 0.35 },
      { tenor: '2Y',  tenorYears: 2,    krd: 0.58 },
      { tenor: '3Y',  tenorYears: 3,    krd: 0.72 },
      { tenor: '5Y',  tenorYears: 5,    krd: 0.85 },
      { tenor: '7Y',  tenorYears: 7,    krd: 0.62 },
      { tenor: '10Y', tenorYears: 10,   krd: 0.38 },
      { tenor: '30Y', tenorYears: 30,   krd: 0.18 },
    ],
  };
}

function KRDContent({ data }: { data: KeyRateDurationData }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'mod_duration',       label: locale === 'es' ? 'Duración Modificada' : 'Modified Duration', value: data.portfolioModifiedDuration,  unit: 'years' },
    { key: 'eff_duration',       label: locale === 'es' ? 'Duración Efectiva'   : 'Effective Duration', value: data.portfolioEffectiveDuration, unit: 'years' },
    { key: 'convexity',          value: data.portfolioConvexity, unit: 'x' },
    { key: 'duration_gap',       label: locale === 'es' ? 'Brecha Duración' : 'Duration Gap', value: data.durationGap, unit: 'years' },
    { key: 'neg_convexity_exp',  label: locale === 'es' ? 'Conv. Negativa' : 'Neg. Convexity Exp.',    value: data.negativeConvexityExposure, unit: 'USD_M' },
    { key: 'tenor_points',       label: locale === 'es' ? 'Puntos KRD' : 'KRD Points',                  value: data.portfolioKRDs.length, unit: 'count' },
  ], [data, locale]);

  const instrumentColumns = useMemo<readonly DataTableColumn<InstrumentKRDDetail>[]>(() => [
    { id: 'name',    header: locale === 'es' ? 'Instrumento' : 'Instrument', kind: 'text',   accessor: (r) => r.instrumentName, align: 'text-left' },
    { id: 'balance', header: locale === 'es' ? 'Balance'     : 'Balance',    kind: 'number', accessor: (r) => r.balance,          unit: 'USD_M' },
    { id: 'mod',     header: locale === 'es' ? 'Dur. Mod.'   : 'Mod. Dur.',  kind: 'number', accessor: (r) => r.modifiedDuration,  unit: 'years' },
    { id: 'eff',     header: locale === 'es' ? 'Dur. Efec.'  : 'Eff. Dur.',  kind: 'number', accessor: (r) => r.effectiveDuration, unit: 'years' },
    { id: 'convex',  header: locale === 'es' ? 'Convexidad'  : 'Convexity',  kind: 'custom',
      accessor: (r) => r.convexity,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.convexity < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
          {r.convexity.toFixed(2)}
        </span>
      ),
    },
  ], [locale]);

  // D1: no fixed-income book to compute durations → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.portfolioKRDs.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No fixed-income book is loaded. Load the securities/loan portfolio with cash-flow schedules to compute key-rate durations and convexity.',
          es: 'No hay una cartera de renta fija cargada. Cargue la cartera de valores/préstamos con calendarios de flujo para calcular las duraciones por tasa clave y la convexidad.',
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

      {/* KRD profile chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Perfil KRD del Portafolio' : 'Portfolio KRD Profile'}
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.portfolioKRDs as PortfolioKRDPoint[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: locale === 'es' ? 'Años' : 'Years', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="krd" name="KRD" fill="#14b8a6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Instrument detail */}
      {data.instruments.length > 0 ? (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Detalle por Instrumento' : 'Instrument Detail'}
          </p>
          <DataTable rows={data.instruments} columns={instrumentColumns} locale={locale} rowKey={(r) => r.instrumentName} />
        </section>
      ) : null}
    </>
  );
}

export default function KRDPage() {
  return (
    <AlmPage<KeyRateDurationData>
      slug="key-rate-durations"
      iconTint="emerald"
      validate={validateKRD}
      getDemo={getDemo}
    >
      {(data) => <KRDContent data={data} />}
    </AlmPage>
  );
}
