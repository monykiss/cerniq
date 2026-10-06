"use client";

import type { Locale } from "@/lib/i18n";

/**
 * Loan-stage vocabulary and presentation — the state of one LOAN, which is
 * deliberately not the same thing as the member's lifecycle stage.
 *
 * WHY A SECOND STAGE MODULE
 * -------------------------
 * `lifecycle-stage.tsx` renders `MemberLifecycleStage`: the cooperativa's
 * posture toward a socio. This renders `LoanLifecycleStage`: the servicing and
 * accounting state of a single loan. A member in WORKOUT can hold a perfectly
 * CURRENT auto loan and a NONACCRUAL mortgage at the same time — that is the
 * normal case, so the two vocabularies must stay separate on screen as well as
 * in the schema. See ADR-loan-lifecycle-and-tape-bridge §2.2.
 *
 * Colocated beside the routes and exported from its own module, not from a
 * `page.tsx` — the App Router only permits the default export plus route
 * config on a page, and violating that fails `next build` while passing both
 * eslint and tsc.
 */

export type LoanStage =
  | "ORIGINATED"
  | "CURRENT"
  | "EARLY_DELINQUENCY"
  | "DELINQUENT_30"
  | "DELINQUENT_60"
  | "NONACCRUAL"
  | "WORKOUT"
  | "PAID_OFF"
  | "CHARGED_OFF";

export const LOAN_STAGE_OPTIONS: readonly {
  value: LoanStage;
  en: string;
  es: string;
}[] = [
  { value: "ORIGINATED", en: "Originated", es: "Originado" },
  { value: "CURRENT", en: "Current", es: "Al día" },
  { value: "EARLY_DELINQUENCY", en: "Early delinquency", es: "Mora temprana" },
  {
    value: "DELINQUENT_30",
    en: "30-59 days past due",
    es: "30-59 días de atraso",
  },
  {
    value: "DELINQUENT_60",
    en: "60-89 days past due",
    es: "60-89 días de atraso",
  },
  { value: "NONACCRUAL", en: "Nonaccrual", es: "En no acumulación" },
  { value: "WORKOUT", en: "Restructured", es: "Reestructurado" },
  { value: "PAID_OFF", en: "Paid off", es: "Saldado" },
  { value: "CHARGED_OFF", en: "Charged off", es: "Castigado" },
];

/**
 * Tones run green -> amber -> orange -> rose -> slate as the loan deteriorates,
 * so an operator scanning a member's book sees the distressed loan without
 * reading a single label. PAID_OFF is deliberately neutral rather than green:
 * it is a closed loan, not a performing one, and colouring it like CURRENT
 * would overstate the size of the performing book at a glance.
 */
const LOAN_STAGE_TONE: Record<
  LoanStage,
  { bg: string; text: string; border: string }
> = {
  ORIGINATED: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  CURRENT: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  EARLY_DELINQUENCY: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
  DELINQUENT_30: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  DELINQUENT_60: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  NONACCRUAL: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  WORKOUT: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  PAID_OFF: {
    bg: "bg-slate-50",
    text: "text-slate-500",
    border: "border-slate-200",
  },
  CHARGED_OFF: {
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-300",
  },
};

export function isLoanStage(value: unknown): value is LoanStage {
  return (
    typeof value === "string" &&
    LOAN_STAGE_OPTIONS.some((o) => o.value === value)
  );
}

/** Falls back to the raw enum name so an unmapped stage is visible, not blank. */
export function loanStageLabel(stage: LoanStage, locale: Locale): string {
  const opt = LOAN_STAGE_OPTIONS.find((o) => o.value === stage);
  return opt ? (locale === "es" ? opt.es : opt.en) : stage;
}

/**
 * Renders a loan's stage. A NULL stage is NOT an absence to hide — it means
 * delinquency was never reported for that loan, so the badge says so rather
 * than leaving a blank cell that reads as "fine" (D1).
 */
export function LoanStageBadge({
  stage,
  locale,
}: {
  stage: LoanStage | null;
  locale: Locale;
}) {
  if (stage === null) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400"
        title={
          locale === "es"
            ? "Días de atraso no reportados — no se puede determinar la etapa"
            : "Days past due not reported — stage cannot be determined"
        }
      >
        {locale === "es" ? "Sin clasificar" : "Unclassified"}
      </span>
    );
  }
  const tone = LOAN_STAGE_TONE[stage] ?? LOAN_STAGE_TONE.CHARGED_OFF;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.bg} ${tone.text} ${tone.border}`}
    >
      {loanStageLabel(stage, locale)}
    </span>
  );
}

/**
 * A slim amortization bar. Null progress renders as an em dash rather than an
 * empty bar — an empty bar reads as "0% repaid", which is a different and
 * false claim from "we were not told the original principal".
 */
export function AmortizationBar({
  fraction,
  locale,
}: {
  fraction: number | null;
  locale: Locale;
}) {
  if (fraction === null) {
    return (
      <span
        className="text-xs text-slate-400"
        title={
          locale === "es"
            ? "Principal original no provisto"
            : "Original principal not provided"
        }
      >
        —
      </span>
    );
  }
  const pct = Math.round(fraction * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}
