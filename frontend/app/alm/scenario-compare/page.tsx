'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient, type ScenarioComparisonResponse, type SavedStressScenario, type StressScenarioParams } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { GitCompare, AlertTriangle, Check, X } from 'lucide-react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────

type SavedScenario = SavedStressScenario;
type ComparisonResult = ScenarioComparisonResponse;
type ScenarioParameterKey = keyof StressScenarioParams;

const VERDICT_COLORS: Record<string, string> = {
  RESILIENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ADEQUATE: 'bg-sky-100 text-sky-700 border-sky-200',
  VULNERABLE: 'bg-amber-100 text-amber-700 border-amber-200',
  CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200',
  'N/A': 'bg-slate-100 text-slate-500 border-slate-200',
};

const CHART_COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981'];
const PARAMETER_KEYS: ScenarioParameterKey[] = ['rateShockBps', 'depositRunoffPct', 'defaultRateIncreasePct', 'energyCostShockPct'];

// ─── Main Page ────────────────────────────────────────────────

export default function ScenarioComparePage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();

  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  // Load all saved scenarios
  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoadingList(true);
      try {
        const data = await apiClient.listScenarios(selectedId);
        setScenarios(data.items ?? []);
      } catch {
        setScenarios([]);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [selectedId]);

  const toggleSelection = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      if (prev.length >= 4) return prev; // max 4
      return [...prev, id];
    });
    setComparison(null);
  }, []);

  const runComparison = useCallback(async () => {
    if (selected.length < 2) return;
    setLoading(true);
    try {
      const data = await apiClient.compareScenarios(selected);
      setComparison(data);
    } catch {
      // Build client-side comparison as fallback
      const selectedScenarios = scenarios.filter((s) => selected.includes(s.id));
      setComparison(buildClientComparison(selectedScenarios));
    } finally {
      setLoading(false);
    }
  }, [selected, scenarios]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <p className="text-slate-500 text-sm">
            {locale === 'es' ? 'Seleccione una institución primero' : 'Select an institution first'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50">
            <GitCompare className="h-4 w-4 text-cyan-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">
              {locale === 'es' ? 'Comparar Escenarios' : 'Compare Scenarios'}
            </h1>
            <p className="text-xs text-slate-500">
              {locale === 'es' ? 'Seleccione 2-4 escenarios para comparar lado a lado' : 'Select 2-4 scenarios to compare side by side'}
            </p>
          </div>
        </div>
        <Link
          href="/alm/scenario-builder"
          className="text-xs text-cyan-600 hover:text-cyan-700 transition"
        >
          {locale === 'es' ? '\u2190 Volver al Constructor' : '\u2190 Back to Builder'}
        </Link>
      </div>

      {/* Scenario Selection */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'Escenarios Guardados' : 'Saved Scenarios'} ({scenarios.length})
        </p>

        {loadingList ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          </div>
        ) : scenarios.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            {locale === 'es' ? 'No hay escenarios guardados. Cree algunos en el Constructor de Escenarios.' : 'No saved scenarios. Create some in the Scenario Builder.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {scenarios.map((s) => {
              const isSelected = selected.includes(s.id);
              const params = s.parameters;
              const verdict = s.results?.verdict;
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSelection(s.id)}
                  className={`rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-50 ring-1 ring-cyan-300'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-slate-950 truncate pr-2">{s.name}</p>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300'
                    }`}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Rate: {params?.rateShockBps ?? 0}bps | Dep: {params?.depositRunoffPct ?? 0}% | Def: {params?.defaultRateIncreasePct ?? 0}%
                  </p>
                  {verdict && (
                    <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${VERDICT_COLORS[verdict] || VERDICT_COLORS['N/A']}`}>
                      {verdict}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={runComparison}
            disabled={selected.length < 2 || loading}
            className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:opacity-50"
          >
            {loading ? (
              <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <GitCompare className="h-4 w-4" />
            )}
            {locale === 'es' ? 'Comparar' : 'Compare'} ({selected.length}/4)
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => { setSelected([]); setComparison(null); }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              {locale === 'es' ? 'Limpiar selección' : 'Clear selection'}
            </button>
          )}
        </div>
      </div>

      {/* Comparison Results */}
      {comparison && (
        <div className="space-y-4">
          {/* Verdict Row */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${comparison.scenarios.length}, 1fr)` }}>
            {comparison.scenarios.map((s, i) => {
              const verdict = comparison.comparison.verdicts[i] || 'N/A';
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border p-4 text-center ${VERDICT_COLORS[verdict] || VERDICT_COLORS['N/A']}`}
                >
                  <p className="text-[10px] font-medium uppercase tracking-wider opacity-70 mb-1">{s.name}</p>
                  <p className="text-xl font-bold">{verdict}</p>
                </div>
              );
            })}
          </div>

          {/* Metrics Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Métrica' : 'Metric'}
                  </th>
                  {comparison.scenarios.map((s, i) => (
                    <th key={s.id} className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: CHART_COLORS[i] }}>
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.comparison.rows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-700">{row.metric}</td>
                    {row.values.map((val, i) => {
                      const isBest = val !== null && val === row.best;
                      const isWorst = val !== null && val === row.worst;
                      return (
                        <td key={i} className="px-4 py-3 text-center tabular-nums">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isBest ? 'bg-emerald-50 text-emerald-700' :
                            isWorst ? 'bg-rose-50 text-rose-700' :
                            'text-slate-700'
                          }`}>
                            {val !== null ? val.toFixed(2) : '\u2014'}
                            {isBest && <Check className="h-3 w-3" />}
                            {isWorst && <X className="h-3 w-3" />}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bar Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
              {locale === 'es' ? 'Comparación Visual' : 'Visual Comparison'}
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={buildBarChartData(comparison)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {comparison.scenarios.map((s, i) => (
                  <Bar key={s.id} dataKey={s.name} fill={CHART_COLORS[i]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Parameters Comparison */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
              {locale === 'es' ? 'Parámetros de Entrada' : 'Input Parameters'}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">
                      {locale === 'es' ? 'Parámetro' : 'Parameter'}
                    </th>
                    {comparison.scenarios.map((s, i) => (
                      <th key={s.id} className="px-3 py-2 text-center text-[11px] font-medium" style={{ color: CHART_COLORS[i] }}>
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PARAMETER_KEYS.map((key) => (
                    <tr key={key} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 text-xs font-medium text-slate-600">
                        {key === 'rateShockBps' ? (locale === 'es' ? 'Choque de Tasa (bps)' : 'Rate Shock (bps)') :
                         key === 'depositRunoffPct' ? (locale === 'es' ? 'Fuga de Depósitos (%)' : 'Deposit Runoff (%)') :
                         key === 'defaultRateIncreasePct' ? (locale === 'es' ? 'Aumento Mora (%)' : 'Default Increase (%)') :
                         locale === 'es' ? 'Choque Energía (%)' : 'Energy Shock (%)'}
                      </td>
                      {comparison.scenarios.map((s) => (
                        <td key={s.id} className="px-3 py-2 text-center text-xs tabular-nums text-slate-700">
                          {s.parameters[key] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function buildBarChartData(comparison: ComparisonResult): Array<{ metric: string } & Record<string, number | string | null>> {
  return comparison.comparison.rows
    .filter((r) => r.values.some((v) => v !== null))
    .map((row) => {
      const entry: { metric: string } & Record<string, number | string | null> = { metric: row.metric };
      comparison.scenarios.forEach((s, i) => {
        entry[s.name] = row.values[i];
      });
      return entry;
    });
}

function buildClientComparison(scenarios: SavedScenario[]): ComparisonResult {
  const metricKeys = [
    { key: 'nimImpactBps', label: 'NIM Impact (bps)', higherIsBetter: false },
    { key: 'nimAfter', label: 'NIM After (%)', higherIsBetter: true },
    { key: 'lcrAfter', label: 'LCR After (%)', higherIsBetter: true },
    { key: 'capitalAfter', label: 'Capital After (%)', higherIsBetter: true },
    { key: 'examReadinessAfter', label: 'Exam Readiness', higherIsBetter: true },
  ];

  const rows = metricKeys.map(({ key, label, higherIsBetter }) => {
    const values = scenarios.map((s) => {
      const results = (s.results ?? {}) as Record<string, unknown>;
      return typeof results[key] === 'number' ? results[key] as number : null;
    });
    const valid = values.filter((v): v is number => v !== null);
    return {
      metric: label,
      key,
      higherIsBetter,
      values,
      best: valid.length > 0 ? (higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null,
      worst: valid.length > 0 ? (higherIsBetter ? Math.min(...valid) : Math.max(...valid)) : null,
    };
  });

  const verdicts = scenarios.map((s) => s.results?.verdict ?? 'N/A');

  return {
    scenarios,
    comparison: { rows, verdicts },
  };
}
