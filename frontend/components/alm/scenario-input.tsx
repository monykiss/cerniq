'use client';

import { useState, useCallback } from 'react';
import {
  RotateCcw,
  Play,
  Save,
  X,
  Zap,
  TrendingUp,
  TrendingDown,
  CloudLightning,
  ArrowUpDown,
  ArrowDownUp,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface ScenarioParams {
  rateShockBps: number;
  depositRunoffPct: number;
  prepaymentMultiplier: number;
  creditLossOverridePct: number;
  scenarioType: string;
}

export interface ScenarioInputProps {
  onRun: (params: ScenarioParams) => void;
  onSave?: (params: ScenarioParams, name: string) => void;
  defaultValues?: Partial<ScenarioParams>;
  locale?: 'en' | 'es';
}

/* ── Constants ──────────────────────────────────────────────────────────────── */

const DEFAULTS: ScenarioParams = {
  rateShockBps: 0,
  depositRunoffPct: 0,
  prepaymentMultiplier: 1.0,
  creditLossOverridePct: 0,
  scenarioType: 'custom',
};

interface PresetScenario {
  id: string;
  labelEn: string;
  labelEs: string;
  icon: React.ElementType;
  values: Partial<ScenarioParams>;
}

const PRESETS: PresetScenario[] = [
  {
    id: 'parallel_up_200',
    labelEn: 'Parallel +200',
    labelEs: 'Paralelo +200',
    icon: TrendingUp,
    values: { rateShockBps: 200, scenarioType: 'parallel_up_200' },
  },
  {
    id: 'parallel_down_100',
    labelEn: 'Parallel -100',
    labelEs: 'Paralelo -100',
    icon: TrendingDown,
    values: { rateShockBps: -100, scenarioType: 'parallel_down_100' },
  },
  {
    id: 'steepening',
    labelEn: 'Steepening',
    labelEs: 'Empinamiento',
    icon: ArrowUpDown,
    values: { rateShockBps: 150, depositRunoffPct: 5, scenarioType: 'steepening' },
  },
  {
    id: 'flattening',
    labelEn: 'Flattening',
    labelEs: 'Aplanamiento',
    icon: ArrowDownUp,
    values: { rateShockBps: -50, depositRunoffPct: 2, scenarioType: 'flattening' },
  },
  {
    id: 'pr_recession',
    labelEn: 'PR Recession',
    labelEs: 'Recesion PR',
    icon: Zap,
    values: {
      rateShockBps: -200,
      depositRunoffPct: 15,
      prepaymentMultiplier: 0.7,
      creditLossOverridePct: 4.5,
      scenarioType: 'pr_recession',
    },
  },
  {
    id: 'hurricane_stress',
    labelEn: 'Hurricane Stress',
    labelEs: 'Estres Huracan',
    icon: CloudLightning,
    values: {
      rateShockBps: -100,
      depositRunoffPct: 25,
      prepaymentMultiplier: 0.5,
      creditLossOverridePct: 7.0,
      scenarioType: 'hurricane_stress',
    },
  },
];

/* ── Labels ─────────────────────────────────────────────────────────────────── */

const L = {
  en: {
    title: 'Scenario Builder',
    presets: 'Preset Scenarios',
    rateShock: 'Rate Shock (bps)',
    depositRunoff: 'Deposit Runoff Rate (%)',
    prepayment: 'Prepayment Speed Multiplier',
    creditLoss: 'Credit Loss Override (%)',
    run: 'Run Scenario',
    save: 'Save Scenario',
    compare: 'Compare',
    reset: 'Reset',
    resetAll: 'Reset All',
    saveDialogTitle: 'Save Scenario',
    nameLabel: 'Scenario Name',
    namePlaceholder: 'e.g., Q3 Stress Test',
    descLabel: 'Description (optional)',
    descPlaceholder: 'Describe the scenario assumptions...',
    cancel: 'Cancel',
    saveConfirm: 'Save',
  },
  es: {
    title: 'Constructor de Escenarios',
    presets: 'Escenarios Predefinidos',
    rateShock: 'Choque de Tasa (pbs)',
    depositRunoff: 'Tasa de Retiro de Depositos (%)',
    prepayment: 'Multiplicador de Prepago',
    creditLoss: 'Sobrescritura de Perdida Crediticia (%)',
    run: 'Ejecutar Escenario',
    save: 'Guardar Escenario',
    compare: 'Comparar',
    reset: 'Reiniciar',
    resetAll: 'Reiniciar Todo',
    saveDialogTitle: 'Guardar Escenario',
    nameLabel: 'Nombre del Escenario',
    namePlaceholder: 'ej., Prueba de Estres Q3',
    descLabel: 'Descripcion (opcional)',
    descPlaceholder: 'Describa los supuestos del escenario...',
    cancel: 'Cancelar',
    saveConfirm: 'Guardar',
  },
} as const;

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function ScenarioInput({
  onRun,
  onSave,
  defaultValues,
  locale = 'en',
}: ScenarioInputProps) {
  const t = L[locale];

  const [params, setParams] = useState<ScenarioParams>({
    ...DEFAULTS,
    ...defaultValues,
  });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');

  const update = useCallback(
    <K extends keyof ScenarioParams>(key: K, value: ScenarioParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value, scenarioType: 'custom' }));
    },
    [],
  );

  const applyPreset = useCallback((preset: PresetScenario) => {
    setParams((prev) => ({
      ...DEFAULTS,
      ...prev,
      ...preset.values,
    }));
  }, []);

  const resetAll = useCallback(() => {
    setParams({ ...DEFAULTS, ...defaultValues });
  }, [defaultValues]);

  const handleSave = useCallback(() => {
    if (!saveName.trim() || !onSave) return;
    onSave(params, saveName.trim());
    setShowSaveDialog(false);
    setSaveName('');
    setSaveDesc('');
  }, [onSave, params, saveName]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">{t.title}</h2>
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={t.resetAll}
        >
          <RotateCcw className="h-3 w-3" />
          {t.resetAll}
        </button>
      </div>

      {/* Preset Buttons */}
      <div className="border-b border-slate-100 px-5 py-4">
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {t.presets}
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isActive = params.scenarioType === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                data-testid={`preset-${preset.id}`}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  isActive
                    ? 'border-cyan-300 bg-cyan-50 text-cyan-800 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {locale === 'es' ? preset.labelEs : preset.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sliders */}
      <div className="grid gap-6 px-5 py-5 sm:grid-cols-2">
        {/* Rate Shock */}
        <SliderField
          label={t.rateShock}
          value={params.rateShockBps}
          min={-400}
          max={400}
          step={25}
          unit="bps"
          onChange={(v) => update('rateShockBps', v)}
          onReset={() => update('rateShockBps', DEFAULTS.rateShockBps)}
          resetLabel={t.reset}
        />

        {/* Deposit Runoff */}
        <SliderField
          label={t.depositRunoff}
          value={params.depositRunoffPct}
          min={0}
          max={50}
          step={1}
          unit="%"
          onChange={(v) => update('depositRunoffPct', v)}
          onReset={() => update('depositRunoffPct', DEFAULTS.depositRunoffPct)}
          resetLabel={t.reset}
        />

        {/* Prepayment Multiplier */}
        <SliderField
          label={t.prepayment}
          value={params.prepaymentMultiplier}
          min={0.5}
          max={3.0}
          step={0.1}
          unit="x"
          decimals={1}
          onChange={(v) => update('prepaymentMultiplier', v)}
          onReset={() => update('prepaymentMultiplier', DEFAULTS.prepaymentMultiplier)}
          resetLabel={t.reset}
        />

        {/* Credit Loss Override */}
        <SliderField
          label={t.creditLoss}
          value={params.creditLossOverridePct}
          min={0}
          max={10}
          step={0.1}
          unit="%"
          decimals={1}
          onChange={(v) => update('creditLossOverridePct', v)}
          onReset={() => update('creditLossOverridePct', DEFAULTS.creditLossOverridePct)}
          resetLabel={t.reset}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        {onSave && (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Save className="h-4 w-4" />
            {t.save}
          </button>
        )}
        <button
          onClick={() => onRun(params)}
          data-testid="run-scenario"
          className="flex items-center justify-center gap-2 rounded-lg bg-[#1B3A6B] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#234B82]"
        >
          <Play className="h-4 w-4" />
          {t.run}
        </button>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            role="dialog"
            aria-label={t.saveDialogTitle}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t.saveDialogTitle}</h3>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label={t.cancel}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {t.nameLabel}
                </label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {t.descLabel}
                </label>
                <textarea
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder={t.descPlaceholder}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#234B82] disabled:opacity-40"
              >
                {t.saveConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── SliderField sub-component ──────────────────────────────────────────────── */

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  decimals?: number;
  onChange: (value: number) => void;
  onReset: () => void;
  resetLabel: string;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = 0,
  onChange,
  onReset,
  resetLabel,
}: SliderFieldProps) {
  const displayValue = decimals > 0 ? value.toFixed(decimals) : String(value);

  const handleNumericChange = (raw: string) => {
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(min, Math.min(max, parsed));
    onChange(clamped);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <button
          onClick={onReset}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={`${resetLabel} ${label}`}
        >
          <RotateCcw className="inline h-2.5 w-2.5" /> {resetLabel}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#1B3A6B] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#1B3A6B] [&::-webkit-slider-thumb]:shadow-md"
          aria-label={label}
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={displayValue}
            min={min}
            max={max}
            step={step}
            onChange={(e) => handleNumericChange(e.target.value)}
            className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-slate-800 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            aria-label={`${label} value`}
          />
          <span className="text-[10px] font-medium text-slate-400">{unit}</span>
        </div>
      </div>
    </div>
  );
}
