'use client';

import { useState, useCallback, useEffect } from 'react';
import { apiClient, type StressScenarioParams, type StressScenarioResult } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import {
  SlidersHorizontal,
  Zap,
  Droplets,
  TrendingDown,
  Flame,
  Play,
  Save,
  RotateCcw,
  AlertTriangle,
  Upload,
  ChevronRight,
  BookmarkCheck,
  BarChart3,
} from 'lucide-react';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────

interface SavedScenario {
  id: string;
  name: string;
  params: StressScenarioParams;
  scenarioType: string;
  savedAt: string;
}

type PresetKey = 'hurricane' | 'liquidityCrisis' | 'recession';

// ─── Presets ────────────────────────────────────────────────────

const PRESETS: Array<{ key: PresetKey; params: StressScenarioParams }> = [
  {
    key: 'hurricane',
    params: { rateShockBps: 150, depositRunoffPct: 10, defaultRateIncreasePct: 5, energyCostShockPct: 20 },
  },
  {
    key: 'liquidityCrisis',
    params: { rateShockBps: 50, depositRunoffPct: 20, defaultRateIncreasePct: 0, energyCostShockPct: 0 },
  },
  {
    key: 'recession',
    params: { rateShockBps: -100, depositRunoffPct: 5, defaultRateIncreasePct: 8, energyCostShockPct: 0 },
  },
];

const DEFAULT_PARAMS: StressScenarioParams = {
  rateShockBps: 0,
  depositRunoffPct: 0,
  defaultRateIncreasePct: 0,
  energyCostShockPct: 0,
};

// ─── Helpers ────────────────────────────────────────────────────

const VERDICT_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  RESILIENT: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  ADEQUATE: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  VULNERABLE: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  CRITICAL: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
};

function getChangeColor(before: number, after: number, higherIsBetter: boolean): string {
  if (after === before) return 'text-slate-700';
  const improved = higherIsBetter ? after > before : after < before;
  return improved ? 'text-emerald-700' : 'text-rose-700';
}

function getChangeArrow(before: number, after: number): string {
  if (after > before) return '\u2191';
  if (after < before) return '\u2193';
  return '\u2192';
}

function isSavedScenario(value: unknown): value is SavedScenario {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SavedScenario>;
  const params = candidate.params as Partial<StressScenarioParams> | undefined;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.scenarioType === 'string' &&
    typeof candidate.savedAt === 'string' &&
    !!params &&
    typeof params.rateShockBps === 'number' &&
    typeof params.depositRunoffPct === 'number' &&
    typeof params.defaultRateIncreasePct === 'number' &&
    typeof params.energyCostShockPct === 'number'
  );
}

// ─── Slider Component ───────────────────────────────────────────

function ScenarioSlider({
  label,
  description,
  value,
  min,
  max,
  step,
  unit,
  icon: Icon,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  icon: React.ElementType;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const isNegative = value < 0;
  const displayVal = value > 0 ? `+${value}` : `${value}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <Icon className="h-4 w-4 text-slate-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-950">{label}</p>
            <p className="text-[11px] text-slate-500">{description}</p>
          </div>
        </div>
        <span className={`text-sm font-bold tabular-nums ${isNegative ? 'text-rose-600' : value > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
          {displayVal}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-amber-500"
        style={{
          background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`,
        }}
      />
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── Impact Card ────────────────────────────────────────────────

function ImpactCard({
  label,
  before,
  after,
  unit,
  higherIsBetter,
}: {
  label: string;
  before: number;
  after: number;
  unit: string;
  higherIsBetter: boolean;
}) {
  const color = getChangeColor(before, after, higherIsBetter);
  const arrow = getChangeArrow(before, after);
  const delta = after - before;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-3">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] text-slate-400 mb-0.5">Before</p>
          <p className="text-lg font-bold tabular-nums text-slate-700">{before.toFixed(2)}{unit}</p>
        </div>
        <div className={`text-xl font-bold ${color} px-2`}>{arrow}</div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400 mb-0.5">After</p>
          <p className={`text-lg font-bold tabular-nums ${color}`}>{after.toFixed(2)}{unit}</p>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-slate-100 text-center">
        <span className={`text-xs font-medium tabular-nums ${color}`}>{deltaStr}{unit}</span>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function ScenarioBuilderPage() {
  const { selectedId } = useALM();
  const { t, locale } = useTranslation();

  const [params, setParams] = useState<StressScenarioParams>({ ...DEFAULT_PARAMS });
  const [result, setResult] = useState<StressScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);

  // Load saved scenarios from API (falls back to localStorage for migration)
  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const data = await apiClient.listScenarios(selectedId);
        if (data.items?.length > 0) {
          setSavedScenarios(data.items.map((s) => ({
            id: s.id,
            name: s.name,
            params: s.parameters,
            scenarioType: s.scenarioType,
            savedAt: s.createdAt,
          })));
          return;
        }
      } catch { /* API unavailable, fall back */ }
      try {
        const stored = localStorage.getItem('cerniq_saved_scenarios');
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setSavedScenarios(
              parsed
                .filter(isSavedScenario)
                .map((scenario, index) => ({ ...scenario, id: `local-${Date.now()}-${index}` })),
            );
          }
        }
      } catch { /* ignore */ }
    })();
  }, [selectedId]);

  const updateParam = useCallback((key: keyof StressScenarioParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const applyPreset = useCallback((preset: StressScenarioParams) => {
    setParams({ ...preset });
    setResult(null);
    setSaved(false);
  }, []);

  const resetParams = useCallback(() => {
    setParams({ ...DEFAULT_PARAMS });
    setResult(null);
    setSaved(false);
  }, []);

  const runScenario = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.runCustomStressTest(selectedId, params);
      setResult(data);
      analytics.track(EVENTS.ALM_STRESS_TEST_RUN, {
        institutionId: selectedId,
        type: 'custom_scenario',
        rateShockBps: params.rateShockBps,
        verdict: data.verdict,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run scenario';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedId, params]);

  const saveScenario = useCallback(async () => {
    if (!selectedId) return;
    const name = `Scenario ${new Date().toLocaleString(locale === 'es' ? 'es-PR' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`;
    try {
      const saved_scenario = await apiClient.saveScenario({
        institutionId: selectedId,
        name,
        scenarioType: 'custom',
        parameters: params,
        results: result ?? undefined,
        tags: [],
      });
      const entry: SavedScenario = {
        id: saved_scenario.id,
        name: saved_scenario.name,
        params: { ...params },
        scenarioType: 'custom',
        savedAt: saved_scenario.createdAt,
      };
      setSavedScenarios((prev) => [entry, ...prev].slice(0, 20));
      setSaved(true);
    } catch {
      // Fallback to localStorage
      const entry: SavedScenario = {
        id: `local-${Date.now()}`,
        name,
        params: { ...params },
        scenarioType: 'custom',
        savedAt: new Date().toISOString(),
      };
      const updated = [entry, ...savedScenarios].slice(0, 10);
      setSavedScenarios(updated);
      setSaved(true);
      try { localStorage.setItem('cerniq_saved_scenarios', JSON.stringify(updated)); } catch { /* */ }
    }
  }, [selectedId, params, result, savedScenarios, locale]);

  // No institution selected
  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" aria-hidden />
          <p className="text-slate-500 text-sm">{t('stressTest.noInstitution')}</p>
        </div>
      </div>
    );
  }

  const verdictStyle = result ? VERDICT_STYLES[result.verdict] || VERDICT_STYLES.CRITICAL : null;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-amber-50">
            <SlidersHorizontal className="h-4 w-4 text-amber-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">{t('scenarioBuilder.title')}</h1>
            <p className="text-xs text-slate-500">{t('scenarioBuilder.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={resetParams}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-slate-300"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('scenarioBuilder.reset')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Preset Buttons */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('scenarioBuilder.presets')}</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset.params)}
              className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition hover:border-amber-300 hover:bg-amber-50"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 group-hover:border-amber-200 group-hover:bg-amber-50">
                {preset.key === 'hurricane' && <Flame className="h-3.5 w-3.5 text-orange-500" />}
                {preset.key === 'liquidityCrisis' && <Droplets className="h-3.5 w-3.5 text-blue-500" />}
                {preset.key === 'recession' && <TrendingDown className="h-3.5 w-3.5 text-slate-600" />}
              </span>
              <div className="text-left">
                <p className="text-sm font-medium text-slate-950">
                  {t(`scenarioBuilder.${preset.key}`)}
                </p>
                <p className="text-[10px] text-slate-500">
                  {t(`scenarioBuilder.${preset.key}Desc`)}
                </p>
              </div>
            </button>
          ))}

          {/* Load saved scenarios dropdown */}
          {savedScenarios.length > 0 && (
            <div className="relative group">
              <button className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600 transition hover:border-cyan-300">
                <BookmarkCheck className="h-3.5 w-3.5" />
                {t('scenarioBuilder.loadSaved')}
                <ChevronRight className="h-3 w-3" />
              </button>
              <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-64 rounded-xl border border-slate-200 bg-white shadow-lg">
                {savedScenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => applyPreset(s.params)}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
                  >
                    <p className="font-medium">{s.name}</p>
                    <p className="text-[10px] text-slate-400">
                      Rate: {s.params.rateShockBps}bps, Dep: {s.params.depositRunoffPct}%, Def: {s.params.defaultRateIncreasePct}%, Energy: {s.params.energyCostShockPct}%
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compare link */}
          {savedScenarios.length >= 2 && (
            <Link
              href="/alm/scenario-compare"
              className="flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-xs font-medium text-cyan-700 transition hover:bg-cyan-100"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {locale === 'es' ? 'Comparar Escenarios' : 'Compare Scenarios'}
            </Link>
          )}
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ScenarioSlider
          label={t('scenarioBuilder.rateShock')}
          description={t('scenarioBuilder.rateShockDesc')}
          value={params.rateShockBps}
          min={-300}
          max={300}
          step={25}
          unit={t('scenarioBuilder.bps')}
          icon={Zap}
          onChange={(v) => updateParam('rateShockBps', v)}
        />
        <ScenarioSlider
          label={t('scenarioBuilder.depositRunoff')}
          description={t('scenarioBuilder.depositRunoffDesc')}
          value={params.depositRunoffPct}
          min={0}
          max={30}
          step={1}
          unit="%"
          icon={Droplets}
          onChange={(v) => updateParam('depositRunoffPct', v)}
        />
        <ScenarioSlider
          label={t('scenarioBuilder.loanDefaultIncrease')}
          description={t('scenarioBuilder.loanDefaultIncreaseDesc')}
          value={params.defaultRateIncreasePct}
          min={0}
          max={15}
          step={0.5}
          unit="%"
          icon={TrendingDown}
          onChange={(v) => updateParam('defaultRateIncreasePct', v)}
        />
        <ScenarioSlider
          label={t('scenarioBuilder.energyCostShock')}
          description={t('scenarioBuilder.energyCostShockDesc')}
          value={params.energyCostShockPct}
          min={0}
          max={50}
          step={5}
          unit="%"
          icon={Flame}
          onChange={(v) => updateParam('energyCostShockPct', v)}
        />
      </div>

      {/* Run Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={runScenario}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? (
            <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {loading ? t('scenarioBuilder.runningScenario') : t('scenarioBuilder.runScenario')}
        </button>
        {result && (
          <button
            onClick={saveScenario}
            disabled={saved}
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-3 text-sm font-medium transition ${
              saved
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300'
            }`}
          >
            <Save className="h-4 w-4" />
            {saved ? t('scenarioBuilder.scenarioSaved') : t('scenarioBuilder.saveScenario')}
          </button>
        )}
      </div>

      {/* Results Panel */}
      {result && (
        <div className="space-y-4">
          {/* Verdict Badge */}
          <div className={`flex items-center justify-between rounded-xl border p-4 ${verdictStyle?.bg} ${verdictStyle?.border}`}>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">{t('scenarioBuilder.verdict')}</p>
              <p className={`text-2xl font-bold ${verdictStyle?.text}`}>
                {t(`scenarioBuilder.${result.verdict.toLowerCase()}`)}
              </p>
            </div>
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${verdictStyle?.border} ${verdictStyle?.bg}`}>
              {result.verdict === 'RESILIENT' && <span className="text-2xl">&#10003;</span>}
              {result.verdict === 'ADEQUATE' && <span className="text-2xl">&#8776;</span>}
              {result.verdict === 'VULNERABLE' && <span className="text-2xl">&#9888;</span>}
              {result.verdict === 'CRITICAL' && <span className="text-2xl">&#10007;</span>}
            </div>
          </div>

          {/* Impact Cards — 2x2 on desktop, single column on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ImpactCard
              label={t('scenarioBuilder.nim')}
              before={result.nimBefore}
              after={result.nimAfter}
              unit="%"
              higherIsBetter={true}
            />
            <ImpactCard
              label={t('scenarioBuilder.lcr')}
              before={result.lcrBefore}
              after={result.lcrAfter}
              unit="%"
              higherIsBetter={true}
            />
            <ImpactCard
              label={t('scenarioBuilder.capital')}
              before={result.capitalBefore}
              after={result.capitalAfter}
              unit="%"
              higherIsBetter={true}
            />
            <ImpactCard
              label={t('scenarioBuilder.examReadiness')}
              before={result.examReadinessBefore}
              after={result.examReadinessAfter}
              unit=" pts"
              higherIsBetter={true}
            />
          </div>

          {/* Narrative */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-3">{t('scenarioBuilder.narrative')}</p>
            <p className="text-sm leading-relaxed text-slate-700">
              {locale === 'es' ? result.narrativeEs : result.narrative}
            </p>
          </div>
        </div>
      )}

      {/* No-data graceful degradation message */}
      {result && result.nimBefore === 0 && result.lcrBefore === 0 && result.capitalBefore === 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <Upload className="h-8 w-8 text-amber-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{t('scenarioBuilder.noDataTitle')}</p>
            <p className="text-xs text-amber-700 mt-1">{t('scenarioBuilder.noDataDesc')}</p>
          </div>
          <Link
            href="/alm/balance-sheet"
            className="ml-auto shrink-0 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
          >
            {t('alm.balanceSheet')}
          </Link>
        </div>
      )}
    </div>
  );
}
