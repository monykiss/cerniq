'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Check, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface CreditRiskSegment {
  readonly segmentName: string;
  readonly balance: number;
  readonly annualPD: number;
  readonly lifetimePD: number;
  readonly lgd: number;
  readonly expectedLoss: number;
  readonly unexpectedLoss: number;
  readonly economicCapital: number;
  readonly elPct: number;
  readonly ecPct: number;
}

interface CreditRiskPortfolio extends AlmDataShell {
  readonly segments: readonly CreditRiskSegment[];
  // D1: null when there are no loan segments to compute portfolio credit risk.
  readonly totalEAD: number | null;
  readonly totalEL: number | null;
  readonly totalUL: number | null;
  readonly totalEC: number | null;
  readonly portfolioElPct: number | null;
  readonly portfolioEcPct: number | null;
  readonly capitalAdequacy: {
    readonly actualCapital: number;
    readonly requiredEconomicCapital: number;
    readonly capitalSurplus: number;
    readonly isAdequate: boolean;
  } | null;
}

function validateCreditRisk(raw: unknown): CreditRiskPortfolio {
  if (!raw || typeof raw !== 'object') throw new Error('Credit risk response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null totals + null capitalAdequacy +
  // gaps[]); validate STRUCTURE only — `segments` is the array the content maps.
  if (!Array.isArray(r.segments)) throw new Error('Credit risk: segments must be array');
  return r as unknown as CreditRiskPortfolio;
}

function getDemo(): CreditRiskPortfolio {
  return {
    segments: [
      { segmentName: 'Consumer Loans',       balance:  85, annualPD: 0.0312, lifetimePD: 0.1048, lgd: 0.45, expectedLoss: 4.01, unexpectedLoss: 5.82, economicCapital:  6.98, elPct: 4.72, ecPct:  8.21 },
      { segmentName: 'Auto Loans',           balance:  62, annualPD: 0.0198, lifetimePD: 0.0804, lgd: 0.35, expectedLoss: 1.74, unexpectedLoss: 2.95, economicCapital:  3.54, elPct: 2.81, ecPct:  5.71 },
      { segmentName: 'Commercial RE',        balance: 120, annualPD: 0.0145, lifetimePD: 0.1035, lgd: 0.40, expectedLoss: 4.97, unexpectedLoss: 8.40, economicCapital: 10.92, elPct: 4.14, ecPct:  9.10 },
      { segmentName: 'Residential Mortgage', balance:  95, annualPD: 0.0082, lifetimePD: 0.1156, lgd: 0.30, expectedLoss: 3.29, unexpectedLoss: 5.70, economicCapital:  7.41, elPct: 3.46, ecPct:  7.80 },
      { segmentName: 'Credit Cards',         balance:  28, annualPD: 0.0685, lifetimePD: 0.0988, lgd: 0.85, expectedLoss: 2.35, unexpectedLoss: 1.82, economicCapital:  2.00, elPct: 8.39, ecPct:  7.14 },
      { segmentName: 'C&I Loans',            balance:  55, annualPD: 0.0234, lifetimePD: 0.1115, lgd: 0.50, expectedLoss: 3.07, unexpectedLoss: 4.85, economicCapital:  6.31, elPct: 5.58, ecPct: 11.47 },
    ],
    totalEAD: 445, totalEL: 19.43, totalUL: 29.54, totalEC: 37.16,
    portfolioElPct: 4.37, portfolioEcPct: 8.35,
    capitalAdequacy: { actualCapital: 40.1, requiredEconomicCapital: 37.16, capitalSurplus: 2.94, isAdequate: true },
  };
}

function CreditRiskContent({ data }: { data: CreditRiskPortfolio }) {
  const { locale } = useTranslation();
  const ca = data.capitalAdequacy;
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'ead',          label: 'EAD', value: data.totalEAD, unit: 'USD_M' },
    { key: 'el',           label: locale === 'es' ? 'Pérdida Esperada'   : 'Expected Loss',     value: data.totalEL, unit: 'USD_M' },
    { key: 'ul',           label: locale === 'es' ? 'Pérdida Inesperada' : 'Unexpected Loss',   value: data.totalUL, unit: 'USD_M' },
    { key: 'ec',           label: locale === 'es' ? 'Capital Económico'  : 'Economic Capital',  value: data.totalEC, unit: 'USD_M' },
    { key: 'portfolio_el_pct', label: 'EL %', value: data.portfolioElPct, unit: '%' },
    { key: 'portfolio_ec_pct', label: 'EC %', value: data.portfolioEcPct, unit: '%' },
  ], [data, locale]);

  const chartData = useMemo(
    () => data.segments.map((s) => ({
      name: s.segmentName,
      EL: +s.expectedLoss.toFixed(2),
      UL: +s.unexpectedLoss.toFixed(2),
      EC: +s.economicCapital.toFixed(2),
    })),
    [data],
  );

  const columns = useMemo<readonly DataTableColumn<CreditRiskSegment>[]>(() => [
    { id: 'segment',    header: locale === 'es' ? 'Segmento'  : 'Segment',    kind: 'text',   accessor: (r) => r.segmentName, align: 'text-left' },
    { id: 'balance',    header: 'EAD',                                        kind: 'number', accessor: (r) => r.balance,    unit: 'USD_M' },
    { id: 'annual_pd',  header: locale === 'es' ? 'PD Anual'   : 'Annual PD',   kind: 'number', accessor: (r) => r.annualPD,   unit: 'ratio' },
    { id: 'lifetime_pd',header: locale === 'es' ? 'PD Vida'    : 'Lifetime PD', kind: 'number', accessor: (r) => r.lifetimePD, unit: 'ratio' },
    { id: 'lgd',        header: 'LGD',                                         kind: 'number', accessor: (r) => r.lgd,        unit: 'ratio' },
    { id: 'el',         header: 'EL',                                          kind: 'number', accessor: (r) => r.expectedLoss,   unit: 'USD_M' },
    { id: 'ul',         header: 'UL',                                          kind: 'number', accessor: (r) => r.unexpectedLoss, unit: 'USD_M' },
    { id: 'ec',         header: 'EC',                                          kind: 'number', accessor: (r) => r.economicCapital,unit: 'USD_M' },
    { id: 'ec_pct',     header: 'EC %',                                        kind: 'custom',
      accessor: (r) => r.ecPct,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.ecPct > 10 ? 'text-rose-700' : 'text-slate-700'}`}>
          {r.ecPct.toFixed(1)}%
        </span>
      ),
    },
  ], [locale]);

  // D1: no loan segments to model → honest neutral panel + gaps (also narrows
  // `ca` to non-null for the capital-adequacy banner below).
  if (isDataUnavailable(data) || data.segments.length === 0 || ca == null) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No loan segments are loaded. Load the loan portfolio (balances, PD, LGD) to compute expected loss, economic capital, and capital adequacy.',
          es: 'No hay segmentos de préstamos cargados. Cargue la cartera de préstamos (saldos, PD, LGD) para calcular la pérdida esperada, el capital económico y la suficiencia de capital.',
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

      {/* Capital adequacy banner */}
      <section className={`flex items-center justify-between rounded-xl border p-4 ${
        ca.isAdequate ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
      }`}>
        <div className="flex items-center gap-3">
          {ca.isAdequate ? <Check className="h-6 w-6 text-emerald-600" /> : <X className="h-6 w-6 text-rose-600" />}
          <div>
            <p className={`text-sm font-bold ${ca.isAdequate ? 'text-emerald-700' : 'text-rose-700'}`}>
              {ca.isAdequate
                ? (locale === 'es' ? 'Capital Adecuado' : 'Capital Adequate')
                : (locale === 'es' ? 'Capital Insuficiente' : 'Capital Insufficient')}
            </p>
            <p className="text-xs text-slate-600">
              {locale === 'es' ? 'Capital actual' : 'Actual capital'}: ${ca.actualCapital}M {'·'}{' '}
              {locale === 'es' ? 'Requerido' : 'Required'}: ${ca.requiredEconomicCapital}M {'·'}{' '}
              {locale === 'es' ? 'Excedente' : 'Surplus'}: ${ca.capitalSurplus}M
            </p>
          </div>
        </div>
      </section>

      {/* EL / UL / EC chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pérdida Esperada / Inesperada / Capital Económico' : 'Expected / Unexpected Loss / Economic Capital'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0)}M`, '']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="EL" name={locale === 'es' ? 'EL' : 'Expected Loss'}   fill="#f59e0b" stackId="loss" />
            <Bar dataKey="UL" name={locale === 'es' ? 'UL' : 'Unexpected Loss'} fill="#dc2626" stackId="loss" radius={[4, 4, 0, 0]} />
            <Bar dataKey="EC" name={locale === 'es' ? 'EC' : 'Economic Capital'} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Segment table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle por Segmento' : 'Segment Detail'}
        </p>
        <DataTable rows={data.segments} columns={columns} locale={locale} rowKey={(r) => r.segmentName} />
      </section>
    </>
  );
}

export default function CreditRiskPage() {
  return (
    <AlmPage<CreditRiskPortfolio>
      slug="credit-risk"
      iconTint="rose"
      validate={validateCreditRisk}
      getDemo={getDemo}
    >
      {(data) => <CreditRiskContent data={data} />}
    </AlmPage>
  );
}
