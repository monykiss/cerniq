/**
 * Board Report page — pure helpers.
 *
 * Kept separate from `page.tsx` so the D1-critical logic (response validation,
 * the honest `—` rendering for null KPIs, and gap counting) is unit-tested
 * without rendering React. The page is a thin shell over these.
 *
 * Backend contract: `GET /api/alm/{id}/board-report` → `BoardReportData`
 * (see backend-node/src/alm/board-report.service.ts). Every numeric KPI is
 * `number | null`. NIM and NWR (razón de capital) are derived from real data;
 * the remaining six are explicitly `null` plus a WARNING `gaps[]` entry until
 * their service is wired. A null KPI is NOT a measured zero — it MUST render
 * as `—`, never `0`, never an invented fallback. `formatBoardKpi` is the
 * frontend half of that D1 contract, and it is the reason this file exists
 * (the page previously fabricated a full KPI set via a `getDemo()` fallback —
 * the worst silent-fallback pattern in the codebase, removed 2026-06-07).
 */

import type { DataGap } from '@/hooks/useReportDataGaps';

// ─── Types (mirror the backend BoardReportData shape) ────────────────────────

/**
 * KPIs as returned by the board-report service. All nullable: a `null` means
 * "not available", never a real zero. Field names match the backend exactly
 * (`eveSensitivity`/`nplRatio`/`ceclCoverage`, NOT the legacy `eve`/`npl`/`cecl`).
 */
export interface BoardReportKpis {
  readonly nim: number | null;
  readonly lcr: number | null;
  readonly nsfr: number | null;
  readonly nwr: number | null;
  readonly eveSensitivity: number | null;
  readonly nplRatio: number | null;
  readonly ceclCoverage: number | null;
  readonly roa: number | null;
}

export type BoardKpiField = keyof BoardReportKpis;

export interface BoardReportSection {
  readonly title: string;
  readonly titleEs: string;
  readonly pageRange: string;
}

export interface BoardReportRegPulseItem {
  readonly deadline: string;
  readonly deadlineEs: string;
  readonly date: string;
  /** Backend types this as a free `string` — defensive tone mapping below. */
  readonly urgency: string;
}

export interface BoardReportData {
  readonly institutionName: string;
  readonly reportMonth: string;
  readonly generatedAt: string;
  readonly camelComposite: number;
  readonly kpis: BoardReportKpis;
  readonly sections: readonly BoardReportSection[];
  readonly topRisks: readonly string[];
  readonly topRisksEs: readonly string[];
  readonly recommendations: readonly string[];
  readonly recommendationsEs: readonly string[];
  readonly regPulse: readonly BoardReportRegPulseItem[];
  readonly gaps?: DataGap[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Trust-but-verify the response shape. Throws (→ AlmPage error state) on a
 * structural mismatch; never silently coerces, and — critically — never falls
 * back to fabricated data. A board package is what a cooperativa's junta
 * directiva reads; an unexpected shape must surface as an explicit error, not
 * phantom KPIs.
 */
export function validateBoardReport(raw: unknown): BoardReportData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Board report must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.institutionName !== 'string') {
    throw new Error('Board report: missing institutionName');
  }
  if (typeof r.reportMonth !== 'string') {
    throw new Error('Board report: missing reportMonth');
  }
  if (!r.kpis || typeof r.kpis !== 'object') {
    throw new Error('Board report: missing kpis');
  }
  if (!Array.isArray(r.sections)) {
    throw new Error('Board report: sections must be an array');
  }
  if (!Array.isArray(r.topRisks) || !Array.isArray(r.recommendations)) {
    throw new Error('Board report: topRisks/recommendations must be arrays');
  }
  if (!Array.isArray(r.regPulse)) {
    throw new Error('Board report: regPulse must be an array');
  }
  return r as unknown as BoardReportData;
}

// ─── KPI tiles ───────────────────────────────────────────────────────────────

export interface BoardKpiSpec {
  readonly field: BoardKpiField;
  readonly labelEn: string;
  readonly labelEs: string;
}

/**
 * Display order + bilingual labels for the eight board KPIs. The two derived
 * KPIs (NIM, NWR) lead so a director sees real numbers first; the six
 * pending-wiring KPIs follow and will read `—` until their backend sources
 * land. Labels are Spanish-first by design (`razón de capital`, etc.) — we
 * supply them explicitly rather than via the generic labels dictionary so the
 * board view never depends on a humanize() fallback for an unmapped key.
 */
export const BOARD_KPI_SPECS: readonly BoardKpiSpec[] = [
  { field: 'nim', labelEn: 'Net Interest Margin', labelEs: 'Margen de Interés Neto' },
  { field: 'nwr', labelEn: 'Net Worth Ratio', labelEs: 'Razón de Capital' },
  { field: 'lcr', labelEn: 'Liquidity Coverage', labelEs: 'Cobertura de Liquidez' },
  { field: 'nsfr', labelEn: 'Net Stable Funding', labelEs: 'Financiamiento Estable' },
  { field: 'eveSensitivity', labelEn: 'EVE Sensitivity', labelEs: 'Sensibilidad EVE' },
  { field: 'nplRatio', labelEn: 'NPL Ratio', labelEs: 'Razón de Morosidad' },
  { field: 'ceclCoverage', labelEn: 'CECL Coverage', labelEs: 'Cobertura CECL' },
  { field: 'roa', labelEn: 'Return on Assets', labelEs: 'Retorno sobre Activos' },
];

/**
 * Render a board KPI value honestly. D1: a null/undefined/non-finite KPI is
 * "not available" — show `—`, never `0`, never an invented number. Every board
 * KPI is a percentage on the backend (NIM, NWR, LCR, NSFR, EVE sensitivity,
 * NPL, CECL coverage, ROA), so the formatted form is `NN.NN%`.
 */
export function formatBoardKpi(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

export interface BoardKpiTile {
  readonly field: BoardKpiField;
  readonly label: string;
  /** Formatted value, or `—` when not available. */
  readonly display: string;
  /** False when the KPI is null — drives the "no disponible" hint + muted style. */
  readonly available: boolean;
}

/** Build the eight display tiles from the raw KPI object for a given locale. */
export function buildBoardKpiTiles(
  kpis: BoardReportKpis,
  es: boolean,
): readonly BoardKpiTile[] {
  return BOARD_KPI_SPECS.map((spec) => {
    const value = kpis[spec.field];
    const available = value != null && Number.isFinite(value);
    return {
      field: spec.field,
      label: es ? spec.labelEs : spec.labelEn,
      display: formatBoardKpi(value),
      available,
    };
  });
}

// ─── Gap counting ────────────────────────────────────────────────────────────

export interface BoardGapCounts {
  readonly critical: number;
  readonly warning: number;
}

/** Tally CRITICAL vs WARNING gaps for the DataGapBanner summary line. */
export function countBoardGaps(
  gaps: readonly DataGap[] | undefined,
): BoardGapCounts {
  let critical = 0;
  let warning = 0;
  for (const g of gaps ?? []) {
    if (g.severity === 'CRITICAL') critical += 1;
    else if (g.severity === 'WARNING') warning += 1;
  }
  return { critical, warning };
}

// ─── Regulatory pulse urgency ────────────────────────────────────────────────

export type UrgencyTone = 'high' | 'medium' | 'low';

/**
 * Map the backend's free-string urgency to a semáforo tone. Unknown values
 * degrade to `low` rather than throwing — a malformed urgency must not break
 * the whole board view.
 */
export function urgencyTone(urgency: string): UrgencyTone {
  switch (urgency.toUpperCase()) {
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    default:
      return 'low';
  }
}

/** Bilingual urgency label (Spanish-first via `es`). */
export function urgencyLabel(urgency: string, es: boolean): string {
  switch (urgencyTone(urgency)) {
    case 'high':
      return es ? 'Alta' : 'High';
    case 'medium':
      return es ? 'Media' : 'Medium';
    case 'low':
      return es ? 'Baja' : 'Low';
  }
}
