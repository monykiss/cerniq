'use client';

import { useMemo } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

/**
 * IRR Policy Monitor — EVE / NII / Duration / Repricing gap limits tracker.
 * Migrated to AlmPage: registry header, discriminated-union fetch, density
 * primitives for the limits table.
 */

type PolicyLevel = 'COMPLIANT' | 'WATCH' | 'WARNING' | 'BREACH';
type OverallStatus = 'GREEN' | 'AMBER' | 'RED';

interface PolicyCheck {
  readonly limitType: string;
  readonly scenario: string;
  readonly actualValue: number;
  readonly watchPct: number;
  readonly warningPct: number;
  readonly breachPct: number;
  readonly level: PolicyLevel;
  readonly utilizationPct: number;
  readonly regulatoryRef: string;
}

interface PolicyDashboard {
  readonly checks: readonly PolicyCheck[];
  readonly breachCount: number;
  readonly warningCount: number;
  readonly watchCount: number;
  readonly overallStatus: OverallStatus;
  readonly lastChecked: string;
}

const LEVEL_STYLES: Record<PolicyLevel, { bg: string; text: string; border: string }> = {
  COMPLIANT: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  WATCH:     { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200' },
  WARNING:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  BREACH:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
};

const STATUS_BANNER: Record<OverallStatus, { bg: string; border: string; text: string; Icon: typeof Check }> = {
  GREEN: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', Icon: Check },
  AMBER: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   Icon: AlertTriangle },
  RED:   { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    Icon: X },
};

function validateDashboard(raw: unknown): PolicyDashboard {
  if (!raw || typeof raw !== 'object') throw new Error('IRR policy response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.checks)) throw new Error('IRR policy: checks must be array');
  if (typeof r.overallStatus !== 'string') throw new Error('IRR policy: missing overallStatus');
  return r as unknown as PolicyDashboard;
}

function getDemo(): PolicyDashboard {
  return {
    checks: [
      { limitType: 'EVE_PCT',       scenario: '+200bps', actualValue: 15.2, watchPct: 12,  warningPct: 18,  breachPct: 25,  level: 'WARNING',   utilizationPct: 60.8, regulatoryRef: 'Basel IRRBB — EVE outlier test' },
      { limitType: 'EVE_PCT',       scenario: '-200bps', actualValue: 12.8, watchPct: 12,  warningPct: 18,  breachPct: 25,  level: 'WATCH',     utilizationPct: 51.2, regulatoryRef: 'Basel IRRBB — EVE outlier test' },
      { limitType: 'NII_AT_RISK',   scenario: '+200bps', actualValue: 11.5, watchPct: 10,  warningPct: 15,  breachPct: 20,  level: 'WATCH',     utilizationPct: 57.5, regulatoryRef: 'OCIF CC-2022-03 §IV.A' },
      { limitType: 'NII_AT_RISK',   scenario: '-100bps', actualValue: 8.2,  watchPct: 8,   warningPct: 12,  breachPct: 15,  level: 'WATCH',     utilizationPct: 54.7, regulatoryRef: 'OCIF CC-2022-03 §IV.A' },
      { limitType: 'DURATION_GAP',  scenario: 'base',    actualValue: 2.1,  watchPct: 2.5, warningPct: 3.5, breachPct: 5.0, level: 'COMPLIANT', utilizationPct: 42,   regulatoryRef: 'COSSEC Examen Art. 7.3' },
      { limitType: 'REPRICING_GAP', scenario: '0-90d',   actualValue: 12.5, watchPct: 15,  warningPct: 20,  breachPct: 25,  level: 'COMPLIANT', utilizationPct: 50,   regulatoryRef: 'OCIF CC-2022-03 §IV.B' },
    ],
    breachCount: 0,
    warningCount: 1,
    watchCount: 3,
    overallStatus: 'AMBER',
    lastChecked: new Date().toISOString(),
  };
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function IRRContent({ data }: { data: PolicyDashboard }) {
  const { locale } = useTranslation();

  const banner = STATUS_BANNER[data.overallStatus];
  const BannerIcon = banner.Icon;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'total_checks',  label: locale === 'es' ? 'Chequeos'       : 'Total Checks',  value: data.checks.length, unit: 'count' },
    { key: 'breach_count',  label: locale === 'es' ? 'Incumplim.'     : 'Breaches',      value: data.breachCount,   unit: 'count' },
    { key: 'warning_count', label: locale === 'es' ? 'Advertencias'   : 'Warnings',      value: data.warningCount,  unit: 'count' },
    { key: 'watch_count',   label: locale === 'es' ? 'Vigilancia'     : 'Watches',       value: data.watchCount,    unit: 'count' },
    { key: 'compliant',     label: locale === 'es' ? 'Cumplen'        : 'Compliant',     value: data.checks.filter((c) => c.level === 'COMPLIANT').length, unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<PolicyCheck>[]>(() => [
    { id: 'type',     header: locale === 'es' ? 'Tipo' : 'Type', kind: 'custom',
      accessor: (r) => r.limitType,
      render: (r) => <span className="text-xs font-medium text-slate-800">{titleCase(r.limitType)}</span>,
      align: 'text-left',
    },
    { id: 'scenario', header: locale === 'es' ? 'Escenario' : 'Scenario', kind: 'text', accessor: (r) => r.scenario },
    { id: 'actual',   header: locale === 'es' ? 'Actual' : 'Actual',     kind: 'number', accessor: (r) => r.actualValue,     unit: '%' },
    { id: 'watch',    header: locale === 'es' ? 'Vigilancia' : 'Watch',  kind: 'number', accessor: (r) => r.watchPct,        unit: '%' },
    { id: 'warning',  header: locale === 'es' ? 'Advertencia' : 'Warning', kind: 'number', accessor: (r) => r.warningPct,    unit: '%' },
    { id: 'breach',   header: locale === 'es' ? 'Límite' : 'Breach',     kind: 'number', accessor: (r) => r.breachPct,       unit: '%' },
    { id: 'util',     header: locale === 'es' ? 'Uso' : 'Util',          kind: 'number', accessor: (r) => r.utilizationPct,  unit: '%' },
    {
      id: 'level',
      header: locale === 'es' ? 'Estado' : 'Status',
      kind: 'custom',
      accessor: (r) => r.level,
      align: 'text-center',
      render: (r) => {
        const s = LEVEL_STYLES[r.level];
        return (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>
            {r.level}
          </span>
        );
      },
    },
  ], [locale]);

  const headline =
    data.overallStatus === 'GREEN'
      ? (locale === 'es' ? 'Todas las Políticas Cumplidas' : 'All Policies Compliant')
      : data.overallStatus === 'AMBER'
        ? (locale === 'es' ? 'Advertencias Activas' : 'Active Warnings')
        : (locale === 'es' ? 'Incumplimientos Detectados' : 'Policy Breaches Detected');

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <section className={`flex items-center gap-3 rounded-xl border p-4 ${banner.bg} ${banner.border}`}>
        <BannerIcon className={`h-5 w-5 ${banner.text}`} />
        <div>
          <p className={`text-sm font-bold ${banner.text}`}>{headline}</p>
          <p className="text-xs text-slate-600">
            {data.breachCount} {locale === 'es' ? 'incumplimientos' : 'breaches'}
            {' · '}{data.warningCount} {locale === 'es' ? 'advertencias' : 'warnings'}
            {' · '}{data.watchCount} {locale === 'es' ? 'vigilancia'    : 'watches'}
          </p>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Estado por Límite' : 'Limits by Status'}
        </p>
        <DataTable rows={data.checks} columns={columns} locale={locale} rowKey={(r) => `${r.limitType}-${r.scenario}`} />
      </section>
    </>
  );
}

export default function IRRPolicyPage() {
  return (
    <AlmPage<PolicyDashboard>
      slug="irr-policy"
      iconTint="amber"
      validate={validateDashboard}
      getDemo={getDemo}
    >
      {(data) => <IRRContent data={data} />}
    </AlmPage>
  );
}
