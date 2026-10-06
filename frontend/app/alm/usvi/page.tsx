'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { label, labelUnit } from '@/lib/alm/labels';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

/**
 * USVI FSC Framework — global (institution-agnostic) endpoint.
 *
 * Uses `institutionIdOverride` with a sentinel to bypass the no-institution
 * check in useAlmEndpoint; the registry endpoint `/api/alm/usvi/framework`
 * contains no `{id}` placeholder, so substitution is a no-op.
 */

type USVIPeerBenchmarkKey = 'nim' | 'lcr' | 'nwr' | 'loanToShare';

interface USVIDifference {
  readonly area: string;
  readonly pr: string;
  readonly usvi: string;
}

interface USVIComplianceEvent {
  readonly event: string;
  readonly eventEs: string;
  readonly frequency: string;
  readonly nextDueDate: string;
  readonly regulatoryRef: string;
}

interface USVIBenchmarkStats {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
}

interface USVIEconomicParams {
  readonly tourismSeasonalityPeak: readonly number[];
  readonly dominantSector: string;
  readonly populationEstimate: number;
  readonly creditUnionCount: number;
  readonly avgHurricaneCPRSpike: number;
}

interface USVIFrameworkData {
  readonly jurisdiction: string;
  readonly regulator: string;
  readonly complianceCalendar: readonly USVIComplianceEvent[];
  readonly economicParams: USVIEconomicParams;
  readonly peerBenchmarks: Readonly<Record<USVIPeerBenchmarkKey, USVIBenchmarkStats>>;
  readonly differences: readonly USVIDifference[];
}

function validateUSVI(raw: unknown): USVIFrameworkData {
  if (!raw || typeof raw !== 'object') throw new Error('USVI response must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.jurisdiction !== 'string') throw new Error('USVI: missing jurisdiction');
  if (!Array.isArray(r.complianceCalendar)) throw new Error('USVI: complianceCalendar must be array');
  if (!Array.isArray(r.differences)) throw new Error('USVI: differences must be array');
  return r as unknown as USVIFrameworkData;
}

function getDemo(): USVIFrameworkData {
  return {
    jurisdiction: 'USVI',
    regulator: 'USVI Financial Services Commission (FSC)',
    complianceCalendar: [
      { event: 'FSC Annual Examination',  eventEs: 'Examen Anual FSC',    frequency: 'annual',    nextDueDate: '2027-03-31', regulatoryRef: 'USVI FSC §4-201' },
      { event: 'NCUA 5300 Call Report',   eventEs: 'Informe 5300 NCUA',   frequency: 'quarterly', nextDueDate: '2026-05-15', regulatoryRef: 'NCUA §741.6' },
      { event: 'BSA/AML Review',          eventEs: 'Revisión BSA/AML',    frequency: 'annual',    nextDueDate: '2027-03-31', regulatoryRef: 'FinCEN' },
    ],
    economicParams: {
      tourismSeasonalityPeak: [11, 12, 1, 2, 3],
      dominantSector: 'tourism',
      populationEstimate: 87146,
      creditUnionCount: 6,
      avgHurricaneCPRSpike: 0.35,
    },
    peerBenchmarks: {
      nim:         { p25: 2.6, p50: 3.2, p75: 3.8  },
      lcr:         { p25: 95,  p50: 112, p75: 135  },
      nwr:         { p25: 7.5, p50: 9.0, p75: 11.2 },
      loanToShare: { p25: 55,  p50: 65,  p75: 78   },
    },
    differences: [
      { area: 'Primary Regulator',  pr: 'COSSEC',                 usvi: 'USVI FSC' },
      { area: 'Federal Supervisor', pr: 'NCUA (all)',             usvi: 'NCUA (federal) / FSC (state)' },
      { area: 'Primary Language',   pr: 'Spanish',                usvi: 'English' },
      { area: 'Economic Driver',    pr: 'Pharma + tourism + gov', usvi: 'Tourism (dominant)' },
      { area: 'Hurricane Exposure', pr: 'High',                   usvi: 'Very High' },
      { area: 'Credit Union Count', pr: '94 cooperativas',        usvi: '~6 credit unions' },
    ],
  };
}

interface BenchmarkRow {
  readonly key: USVIPeerBenchmarkKey;
  readonly label: string;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
}

function USVIContent({ data }: { data: USVIFrameworkData }) {
  const { locale } = useTranslation();

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'credit_unions',   label: locale === 'es' ? 'Cooperativas'      : 'Credit Unions',       value: data.economicParams.creditUnionCount,      unit: 'count' },
    { key: 'population',      label: locale === 'es' ? 'Población'          : 'Population',         value: data.economicParams.populationEstimate,    unit: 'count' },
    { key: 'hurricane_cpr',   label: locale === 'es' ? 'Spike Huracán CPR'  : 'Hurricane CPR Spike', value: data.economicParams.avgHurricaneCPRSpike, unit: 'ratio' },
    { key: 'compliance_events', label: locale === 'es' ? 'Eventos Cumplim.' : 'Compliance Events',  value: data.complianceCalendar.length,            unit: 'count' },
    { key: 'pr_usvi_diffs',   label: locale === 'es' ? 'Diferencias PR/USVI' : 'PR/USVI Diffs',      value: data.differences.length,                  unit: 'count' },
  ], [data, locale]);

  const benchmarkRows = useMemo<readonly BenchmarkRow[]>(
    () => (Object.entries(data.peerBenchmarks) as Array<[USVIPeerBenchmarkKey, USVIBenchmarkStats]>).map(
      ([key, stats]) => ({ key, label: label(key, locale), ...stats }),
    ),
    [data, locale],
  );

  const benchmarkColumns = useMemo<readonly DataTableColumn<BenchmarkRow>[]>(() => [
    { id: 'metric', header: locale === 'es' ? 'Métrica' : 'Metric', kind: 'custom',
      accessor: (r) => r.label,
      render: (r) => <span className="text-xs font-medium text-slate-700">{r.label}</span>,
      align: 'text-left',
    },
    { id: 'p25',    header: 'P25', kind: 'custom', accessor: (r) => r.p25,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-500">{r.p25}{labelUnit(r.key) === '%' ? '%' : ''}</span>,
    },
    { id: 'p50',    header: 'P50 (median)', kind: 'custom', accessor: (r) => r.p50,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-slate-900">{r.p50}{labelUnit(r.key) === '%' ? '%' : ''}</span>,
    },
    { id: 'p75',    header: 'P75', kind: 'custom', accessor: (r) => r.p75,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-500">{r.p75}{labelUnit(r.key) === '%' ? '%' : ''}</span>,
    },
  ], [locale]);

  const differenceColumns = useMemo<readonly DataTableColumn<USVIDifference>[]>(() => [
    { id: 'area', header: locale === 'es' ? 'Área' : 'Area', kind: 'custom',
      accessor: (r) => r.area,
      render: (r) => <span className="text-xs font-medium text-slate-800">{r.area}</span>,
      align: 'text-left',
    },
    { id: 'pr', header: 'Puerto Rico', kind: 'custom',
      accessor: (r) => r.pr,
      render: (r) => <span className="text-xs text-slate-600">{r.pr}</span>,
      align: 'text-left',
    },
    { id: 'usvi', header: 'USVI', kind: 'custom',
      accessor: (r) => r.usvi,
      render: (r) => <span className="text-xs font-medium text-sky-700">{r.usvi}</span>,
      align: 'text-left',
    },
  ], [locale]);

  const complianceColumns = useMemo<readonly DataTableColumn<USVIComplianceEvent>[]>(() => [
    { id: 'event', header: locale === 'es' ? 'Evento' : 'Event', kind: 'custom',
      accessor: (r) => locale === 'es' ? r.eventEs : r.event,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs text-slate-700">
          <Check className="h-3.5 w-3.5 text-sky-500" aria-hidden />
          {locale === 'es' ? r.eventEs : r.event}
        </span>
      ),
      align: 'text-left',
    },
    { id: 'freq', header: locale === 'es' ? 'Frecuencia' : 'Frequency', kind: 'text', accessor: (r) => r.frequency },
    { id: 'due',  header: locale === 'es' ? 'Próximo'    : 'Next Due',  kind: 'text', accessor: (r) => r.nextDueDate },
    { id: 'ref',  header: locale === 'es' ? 'Referencia' : 'Reference', kind: 'custom',
      accessor: (r) => r.regulatoryRef,
      render: (r) => <span className="text-[10px] font-mono text-slate-400">{r.regulatoryRef}</span>,
    },
  ], [locale]);

  return (
    <>
      <div className="text-[11px] text-slate-500">{data.regulator}</div>

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* PR ↔ USVI differences */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Diferencias PR ↔ USVI' : 'PR ↔ USVI Differences'}
        </p>
        <DataTable
          rows={data.differences}
          columns={differenceColumns}
          locale={locale}
          rowKey={(r) => r.area}
        />
      </section>

      {/* Compliance calendar */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Calendario de Cumplimiento FSC' : 'FSC Compliance Calendar'}
        </p>
        <DataTable
          rows={data.complianceCalendar}
          columns={complianceColumns}
          locale={locale}
          rowKey={(r) => r.event}
        />
      </section>

      {/* Peer benchmarks */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Benchmarks Pares USVI' : 'USVI Peer Benchmarks'}
        </p>
        <DataTable
          rows={benchmarkRows}
          columns={benchmarkColumns}
          locale={locale}
          rowKey={(r) => r.key}
        />
      </section>

      {/* Economic parameters sidebar */}
      <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          {locale === 'es' ? 'Parámetros Económicos' : 'Economic Parameters'}
        </p>
        <div className="grid grid-cols-2 gap-3 text-xs text-amber-800 md:grid-cols-4">
          <div>{locale === 'es' ? 'Sector dominante' : 'Dominant sector'}: <strong>{data.economicParams.dominantSector}</strong></div>
          <div>{locale === 'es' ? 'Cooperativas'     : 'Credit Unions'}:   <strong>{data.economicParams.creditUnionCount}</strong></div>
          <div>Hurricane CPR: <strong>+{(data.economicParams.avgHurricaneCPRSpike * 100).toFixed(0)}%</strong></div>
          <div>{locale === 'es' ? 'Población'        : 'Population'}: <strong>{data.economicParams.populationEstimate.toLocaleString()}</strong></div>
        </div>
      </section>
    </>
  );
}

export default function USVIPage() {
  return (
    <AlmPage<USVIFrameworkData>
      slug="usvi"
      iconTint="sky"
      institutionIdOverride="global"
      validate={validateUSVI}
      getDemo={getDemo}
    >
      {(data) => <USVIContent data={data} />}
    </AlmPage>
  );
}
