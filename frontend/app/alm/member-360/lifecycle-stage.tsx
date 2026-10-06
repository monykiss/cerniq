'use client';

import type { Locale } from '@/lib/i18n';

/**
 * Shared lifecycle-stage vocabulary and presentation for Member 360.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * These used to be named exports of `page.tsx`, imported by the profile route
 * as `import { StageBadge } from '../page'`. Next.js App Router validates the
 * export shape of every `page.tsx` and only allows the default export plus a
 * fixed set of route config exports, so `next build` failed with:
 *
 *     Type error: Page "app/alm/member-360/page.tsx" does not match the
 *     required types of a Next.js Page.
 *
 * `eslint` and `tsc --noEmit` both pass on that arrangement — only a real
 * `next build` catches it, which is exactly the check the Member 360 slice
 * shipped without (ADR-member-360-layer3 §6.3).
 *
 * Colocating this beside the routes keeps it discoverable while leaving the
 * route files export-clean.
 */

export type LifecycleStage =
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'AT_RISK'
  | 'DELINQUENT'
  | 'WORKOUT'
  | 'CHARGED_OFF'
  | 'CHURNED';

export const STAGE_OPTIONS: readonly {
  value: LifecycleStage | 'ALL';
  en: string;
  es: string;
}[] = [
  { value: 'ALL', en: 'All stages', es: 'Todas las etapas' },
  { value: 'ONBOARDING', en: 'Onboarding', es: 'Incorporación' },
  { value: 'ACTIVE', en: 'Active', es: 'Activo' },
  { value: 'AT_RISK', en: 'At risk', es: 'En riesgo' },
  { value: 'DELINQUENT', en: 'Delinquent', es: 'Moroso' },
  { value: 'WORKOUT', en: 'Workout', es: 'Reestructuración' },
  { value: 'CHARGED_OFF', en: 'Charged off', es: 'Castigado' },
  { value: 'CHURNED', en: 'Churned', es: 'Inactivo' },
];

/**
 * Distinct tones per stage so an operator can spot a distressed member by
 * colour while scanning, without reading each label.
 */
const STAGE_TONE: Record<LifecycleStage, { bg: string; text: string; border: string }> = {
  ONBOARDING: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  AT_RISK: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  DELINQUENT: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  WORKOUT: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  CHARGED_OFF: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
  CHURNED: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
};

export function isLifecycleStage(value: unknown): value is LifecycleStage {
  return (
    typeof value === 'string' &&
    STAGE_OPTIONS.some((o) => o.value !== 'ALL' && o.value === value)
  );
}

/** Falls back to the raw enum name so an unmapped stage is visible, not blank. */
export function stageLabel(stage: LifecycleStage, locale: Locale): string {
  const opt = STAGE_OPTIONS.find((o) => o.value === stage);
  return opt ? (locale === 'es' ? opt.es : opt.en) : stage;
}

export function StageBadge({ stage, locale }: { stage: LifecycleStage; locale: Locale }) {
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.CHURNED;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.bg} ${tone.text} ${tone.border}`}
    >
      {stageLabel(stage, locale)}
    </span>
  );
}
