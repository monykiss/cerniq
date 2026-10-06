'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { Play, RefreshCw } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

type Aggressiveness = 'conservative' | 'moderate' | 'aggressive';

interface DeltaAllocation {
  readonly subcategory: string;
  readonly category: string;
  readonly currentBalance: number;
  readonly suggestedBalance: number;
  readonly deltaUSD: number;
  readonly deltaPct: number;
  readonly rateImpact: number;
}

interface ConstraintSlack {
  readonly constraint: string;
  readonly currentValue: number;
  readonly limit: number;
  readonly slack: number;
  readonly binding: boolean;
}

interface OptimizationResult extends AlmDataShell {
  readonly deltaAllocations: readonly DeltaAllocation[];
  // D1: null when there is no balance sheet to optimize against.
  readonly projectedNIIGain: number | null;
  readonly projectedNIIGainPct: number | null;
  readonly constraintSlacks: readonly ConstraintSlack[];
  readonly aggressivenessLevel: string;
  readonly narrative: string;
  readonly narrativeEs: string;
}

function validateOpt(raw: unknown): OptimizationResult {
  if (!raw || typeof raw !== 'object') throw new Error('Capital optimizer response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null projectedNIIGain + gaps[]);
  // validate STRUCTURE only — the arrays the content maps over.
  if (!Array.isArray(r.deltaAllocations)) throw new Error('Capital opt: deltaAllocations must be array');
  if (!Array.isArray(r.constraintSlacks)) throw new Error('Capital opt: constraintSlacks must be array');
  return r as unknown as OptimizationResult;
}

function getDemo(agg: Aggressiveness): OptimizationResult {
  const maxMove = agg === 'conservative' ? 8 : agg === 'moderate' ? 15 : 25;
  const limit = agg === 'conservative' ? 3 : agg === 'moderate' ? 6 : 10;
  return {
    deltaAllocations: [
      { subcategory: 'securities',     category: 'asset', currentBalance: 50, suggestedBalance: 50 - maxMove, deltaUSD: -maxMove, deltaPct: -(maxMove / 445) * 100, rateImpact: -maxMove * 0.042 },
      { subcategory: 'consumer_loans', category: 'asset', currentBalance: 85, suggestedBalance: 85 + maxMove, deltaUSD:  maxMove, deltaPct:  (maxMove / 445) * 100, rateImpact:  maxMove * 0.072 },
    ],
    projectedNIIGain:    +(maxMove * 0.03).toFixed(2),
    projectedNIIGainPct: +((maxMove * 0.03 / 12.8) * 100).toFixed(1),
    constraintSlacks: [
      { constraint: 'LCR ≥ 100%',  currentValue: 115, limit: 100, slack: 15,  binding: false },
      { constraint: 'NSFR ≥ 100%', currentValue: 108, limit: 100, slack:  8,  binding: false },
      { constraint: 'NWR ≥ 7%',    currentValue:   9.2, limit:   7, slack:  2.2, binding: false },
      { constraint: `Max realloc ≤ ${limit}%`, currentValue: +(maxMove / 445 * 100).toFixed(1), limit, slack: 0, binding: true },
    ],
    aggressivenessLevel: agg,
    narrative:   `Shift $${maxMove}M from securities to consumer loans to gain $${(maxMove * 0.03).toFixed(2)}M in annual NII.`,
    narrativeEs: `Traslade $${maxMove}M de valores a préstamos de consumo para ganar $${(maxMove * 0.03).toFixed(2)}M en NII anual.`,
  };
}

function OptContent({ data }: { data: OptimizationResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'projected_nii_gain',     label: locale === 'es' ? 'Ganancia NII'    : 'NII Gain',         value: data.projectedNIIGain,     unit: 'USD_M' },
    { key: 'projected_nii_gain_pct', label: locale === 'es' ? 'Ganancia %'      : 'NII Gain %',       value: data.projectedNIIGainPct,  unit: '%' },
    { key: 'realloc_count',          label: locale === 'es' ? 'Reasignaciones' : 'Reallocations',    value: data.deltaAllocations.length, unit: 'count' },
    { key: 'binding_constraints',    label: locale === 'es' ? 'Restricc. Vinculantes' : 'Binding',  value: data.constraintSlacks.filter((c) => c.binding).length, unit: 'count' },
    { key: 'total_constraints',      label: locale === 'es' ? 'Restricciones'  : 'Constraints',      value: data.constraintSlacks.length, unit: 'count' },
  ], [data, locale]);

  const reallocData = useMemo(
    () => data.deltaAllocations.map((a) => ({
      name: a.subcategory.replace(/_/g, ' '),
      delta: a.deltaUSD,
    })),
    [data],
  );

  const deltaColumns = useMemo<readonly DataTableColumn<DeltaAllocation>[]>(() => [
    { id: 'name',     header: locale === 'es' ? 'Subcategoría' : 'Subcategory', kind: 'custom',
      accessor: (r) => r.subcategory,
      render: (r) => <span className="text-xs font-medium capitalize text-slate-800">{r.subcategory.replace(/_/g, ' ')}</span>,
      align: 'text-left',
    },
    { id: 'current',   header: locale === 'es' ? 'Balance Actual'    : 'Current Balance',   kind: 'number', accessor: (r) => r.currentBalance,   unit: 'USD_M' },
    { id: 'suggested', header: locale === 'es' ? 'Balance Sugerido'  : 'Suggested Balance', kind: 'number', accessor: (r) => r.suggestedBalance, unit: 'USD_M' },
    { id: 'delta',     header: 'Δ ($M)',                                                     kind: 'delta',  accessor: (r) => r.deltaUSD,         unit: 'USD_M' },
    { id: 'rate_imp',  header: locale === 'es' ? 'Impacto Tasa'     : 'Rate Impact',        kind: 'delta',  accessor: (r) => r.rateImpact,       unit: 'USD_M' },
  ], [locale]);

  const constraintColumns = useMemo<readonly DataTableColumn<ConstraintSlack>[]>(() => [
    { id: 'name',    header: locale === 'es' ? 'Restricción' : 'Constraint', kind: 'text', accessor: (r) => r.constraint, align: 'text-left' },
    { id: 'current', header: locale === 'es' ? 'Actual' : 'Current', kind: 'custom',
      accessor: (r) => r.currentValue,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-700">{r.currentValue.toFixed(1)}</span>,
    },
    { id: 'limit',   header: locale === 'es' ? 'Límite' : 'Limit', kind: 'custom',
      accessor: (r) => r.limit,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-500">{r.limit.toFixed(1)}</span>,
    },
    { id: 'slack',   header: 'Slack', kind: 'custom',
      accessor: (r) => r.slack,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.slack < 2 ? 'text-amber-700' : 'text-emerald-700'}`}>
          {r.slack.toFixed(1)}
        </span>
      ),
    },
    { id: 'binding', header: locale === 'es' ? 'Vinculante' : 'Binding', kind: 'custom',
      accessor: (r) => (r.binding ? 'yes' : 'no'),
      align: 'text-center',
      render: (r) => r.binding ? (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">BINDING</span>
      ) : (
        <span className="text-[10px] text-slate-300">—</span>
      ),
    },
  ], [locale]);

  // D1: no balance sheet to optimize against → honest neutral panel + gaps.
  if (isDataUnavailable(data)) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'Capital optimization needs a loaded balance sheet. Load assets and liabilities to compute the reallocation that maximizes NII within the regulatory constraints.',
          es: 'La optimización de capital requiere un balance de situación. Cargue activos y pasivos para calcular la reasignación que maximiza el NII dentro de las restricciones regulatorias.',
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

      {/* Narrative banner */}
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
          {locale === 'es' ? 'Estrategia Recomendada' : 'Recommended Strategy'}
        </p>
        <p className="text-sm leading-relaxed text-emerald-800">{locale === 'es' ? data.narrativeEs : data.narrative}</p>
      </section>

      {/* Reallocation chart */}
      {reallocData.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Reasignación Recomendada' : 'Recommended Reallocation'}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={reallocData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0).toFixed(1)}M`, '']} />
              <ReferenceLine y={0} stroke="#94a3b8" />
              <Bar dataKey="delta" radius={[4, 4, 0, 0]}>
                {reallocData.map((a) => (
                  <Cell key={a.name} fill={a.delta >= 0 ? '#059669' : '#dc2626'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      ) : null}

      {/* Allocation detail */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle de Reasignación' : 'Allocation Detail'}
        </p>
        <DataTable rows={data.deltaAllocations} columns={deltaColumns} locale={locale} rowKey={(r) => `${r.category}-${r.subcategory}`} />
      </section>

      {/* Constraint slacks */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Estado de Restricciones' : 'Constraint Status'}
        </p>
        <DataTable rows={data.constraintSlacks} columns={constraintColumns} locale={locale} rowKey={(r) => r.constraint} />
      </section>
    </>
  );
}

// ─── Page with aggressiveness controls + run-nonce ─────────────────────────

export default function CapitalOptimizerPage() {
  const { locale } = useTranslation();
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>('moderate');
  const [runNonce, setRunNonce] = useState(0);

  return (
    <AlmPage<OptimizationResult>
      slug="capital-optimizer"
      iconTint="emerald"
      method="POST"
      body={{ aggressiveness }}
      deps={[runNonce]}
      validate={validateOpt}
      getDemo={() => getDemo(aggressiveness)}
      controls={
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {(['conservative', 'moderate', 'aggressive'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setAggressiveness(level)}
                aria-pressed={aggressiveness === level}
                className={`px-2.5 py-1 text-[10px] font-semibold transition ${
                  aggressiveness === level ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {level === 'conservative' ? (locale === 'es' ? 'Cons. ±3%'  : 'Cons. ±3%')
                 : level === 'moderate'    ? (locale === 'es' ? 'Mod. ±6%'   : 'Mod. ±6%')
                 :                           (locale === 'es' ? 'Agr. ±10%'  : 'Agg. ±10%')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRunNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
          >
            {runNonce === 0 ? <Play className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {locale === 'es' ? 'Optimizar' : 'Optimize'}
          </button>
        </div>
      }
    >
      {(data) => <OptContent data={data} />}
    </AlmPage>
  );
}
