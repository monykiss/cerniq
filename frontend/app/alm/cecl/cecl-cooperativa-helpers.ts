/**
 * Cooperativa-PR CECL — pure helpers.
 *
 * The CECL page gained a 4th methodology, "Cooperativa PR", which wires the
 * (previously frontend-invisible) PR-native endpoint
 * `GET /api/alm/{id}/cecl/cooperativa`. That engine classifies each loan
 * segment against the COSSEC cooperativa product registry, drops liability-side
 * products from the allowance, fills cold-start PD/LGD from documented PR
 * defaults (emitting a WARNING DataGap per default applied — disclosed
 * configuration, never a silent substitute, D1), and runs PD×LGD under the
 * harsher-than-mainland PR macro overlay.
 *
 * This module holds the D1-critical pure logic so it can be unit-tested without
 * rendering React:
 *   - response validation (`validateCooperativaCecl`)
 *   - the classification-row mapping that derives `side` / `ceclEligible` from
 *     `productType` (the backend row carries only segmentName/productType/
 *     nombre/defaultsApplied — side + eligibility live in this display mirror)
 *   - the disclosed PR overlay constants (multipliers + weights + cold-start
 *     note) the disclosure card renders
 *   - the honest `—`/null mapping for the summary strip when the backend
 *     returns `data_unavailable`
 *
 * Backend contract: `CECLService.getCooperativaCECLAnalysis` in
 * backend-node/src/alm/cecl.service.ts. Overlay constants mirror
 * backend-node/src/alm/cooperativa/product-registry.ts (PR_PD_MULTIPLIERS,
 * PR_SCENARIO_WEIGHTS) — kept in sync by the disclosure-card test below.
 */

import type { DataGap } from '@/hooks/useReportDataGaps';

// ─── Product taxonomy (display mirror of the backend registry) ──────────────

export type CooperativaProductType =
  | 'PRESTAMO_PERSONAL'
  | 'PRESTAMO_AUTO'
  | 'HIPOTECA'
  | 'PRESTAMO_COMERCIAL'
  | 'PRESTAMO_GARANTIA_ACCIONES'
  | 'CLUB_NAVIDAD'
  | 'CUENTA_AHORRO'
  | 'CERTIFICADO_DEPOSITO';

export type ProductSide = 'asset' | 'liability';

export interface ProductMeta {
  /** Spanish-first display label (PR cooperativa terminology). */
  readonly es: string;
  /** English label, second-class by design. */
  readonly en: string;
  /** Which side of the balance sheet the product lives on. */
  readonly side: ProductSide;
  /** Whether the product enters the CECL allowance (loans only). */
  readonly ceclEligible: boolean;
}

/**
 * Display metadata per product type. `side` and `ceclEligible` are NOT returned
 * by the cooperativa endpoint per row — they are a stable property of the
 * product type, so we derive them here. Labels mirror the backend registry's
 * `nombre` / `nameEn`; the backend row's `nombre` (when present) takes
 * precedence for the Spanish label so the two never visibly drift.
 */
export const COOPERATIVA_PRODUCT_META: Record<CooperativaProductType, ProductMeta> = {
  PRESTAMO_PERSONAL: { es: 'Préstamos personales', en: 'Personal loans', side: 'asset', ceclEligible: true },
  PRESTAMO_AUTO: { es: 'Préstamos de auto', en: 'Auto loans', side: 'asset', ceclEligible: true },
  HIPOTECA: { es: 'Hipotecas', en: 'Residential mortgages', side: 'asset', ceclEligible: true },
  PRESTAMO_COMERCIAL: { es: 'Préstamos comerciales (MBL)', en: 'Member business loans (MBL)', side: 'asset', ceclEligible: true },
  PRESTAMO_GARANTIA_ACCIONES: { es: 'Préstamos con garantía de acciones', en: 'Share-secured loans', side: 'asset', ceclEligible: true },
  CLUB_NAVIDAD: { es: 'Club de Navidad', en: 'Christmas club accounts', side: 'liability', ceclEligible: false },
  CUENTA_AHORRO: { es: 'Cuentas de ahorro (acciones)', en: 'Share savings accounts', side: 'liability', ceclEligible: false },
  CERTIFICADO_DEPOSITO: { es: 'Certificados de depósito', en: 'Certificates of deposit', side: 'liability', ceclEligible: false },
};

// ─── Response types (the subset the PR view renders) ────────────────────────

export interface CooperativaSegmentResult {
  readonly segmentName: string;
  readonly balance: number;
  readonly methodology: string;
  readonly allowanceRequired: number;
  readonly coverageRatio: number;
}

export interface CooperativaClassificationRaw {
  readonly segmentName: string;
  readonly productType: CooperativaProductType | null;
  readonly nombre: string | null;
  readonly defaultsApplied: boolean;
}

export interface CooperativaMacroBreakdown {
  readonly baseline: number;
  readonly adverse: number;
  readonly severelyAdverse: number;
  readonly weighted: number;
}

export interface CooperativaCECLResult {
  readonly totalBalance: number;
  readonly totalAllowance: number;
  readonly weightedCoverageRatio: number;
  /** Methodology provenance string — always "PD×LGD (PR)" from this endpoint. */
  readonly methodology: string;
  readonly segments: readonly CooperativaSegmentResult[];
  readonly overallStatus?: 'computed' | 'data_unavailable';
  readonly gaps?: DataGap[];
  readonly productClassification: readonly CooperativaClassificationRaw[];
  readonly macroScenarioBreakdown?: CooperativaMacroBreakdown;
}

/**
 * Trust-but-verify the cooperativa response shape. Throws (→ honest error
 * state) on a structural mismatch; never silently coerces. `productClassification`
 * is the field that distinguishes this endpoint from the generic `/cecl`.
 */
export function validateCooperativaCecl(raw: unknown): CooperativaCECLResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Cooperativa CECL response must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.totalBalance !== 'number') {
    throw new Error('Cooperativa CECL: missing totalBalance');
  }
  if (typeof r.totalAllowance !== 'number') {
    throw new Error('Cooperativa CECL: missing totalAllowance');
  }
  if (!Array.isArray(r.segments)) {
    throw new Error('Cooperativa CECL: segments must be an array');
  }
  if (!Array.isArray(r.productClassification)) {
    throw new Error('Cooperativa CECL: productClassification must be an array');
  }
  return r as unknown as CooperativaCECLResult;
}

/**
 * D1: distinguish a computed allowance from a `data_unavailable` shell. When
 * the backend has no CECL-eligible segments it returns zero sentinels +
 * `overallStatus: 'data_unavailable'`; the view must render `—`, never `$0.0M`.
 * An empty `segments[]` is treated the same defensively.
 */
export function isCooperativaDataUnavailable(data: CooperativaCECLResult): boolean {
  return data.overallStatus === 'data_unavailable' || data.segments.length === 0;
}

// ─── Classification-row mapping ─────────────────────────────────────────────

export interface ClassificationViewRow {
  readonly segmentName: string;
  readonly productType: CooperativaProductType | null;
  /** Bilingual product label, falling back to "Sin clasificar" when unmatched. */
  readonly productLabel: string;
  /** Derived from productType; null when the segment did not match the registry. */
  readonly side: ProductSide | null;
  /** Derived from productType; null when unmatched (so the cell shows `—`). */
  readonly ceclEligible: boolean | null;
  readonly defaultsApplied: boolean;
}

/**
 * Map one raw classification row into a render-ready row, deriving `side` and
 * `ceclEligible` from the product type. An unmatched segment (productType null)
 * is surfaced honestly as "Sin clasificar" with `—` for side/eligibility — the
 * backend already emitted a WARNING gap telling the operator to classify it.
 */
export function mapClassificationRow(
  raw: CooperativaClassificationRaw,
  es: boolean,
): ClassificationViewRow {
  const meta = raw.productType ? COOPERATIVA_PRODUCT_META[raw.productType] : null;
  const productLabel = meta
    ? es
      ? (raw.nombre ?? meta.es)
      : meta.en
    : es
      ? 'Sin clasificar'
      : 'Unclassified';
  return {
    segmentName: raw.segmentName,
    productType: raw.productType,
    productLabel,
    side: meta ? meta.side : null,
    ceclEligible: meta ? meta.ceclEligible : null,
    defaultsApplied: raw.defaultsApplied,
  };
}

/** Map the whole classification list, preserving backend order. */
export function mapClassificationRows(
  rows: readonly CooperativaClassificationRaw[],
  es: boolean,
): ClassificationViewRow[] {
  return rows.map((r) => mapClassificationRow(r, es));
}

/** Bilingual balance-sheet side label; `—` for an unclassified segment. */
export function sideLabel(side: ProductSide | null, es: boolean): string {
  if (side === 'asset') return es ? 'Activo' : 'Asset';
  if (side === 'liability') return es ? 'Pasivo' : 'Liability';
  return '—';
}

/** Bilingual yes/no/`—` for the nullable boolean columns. */
export function yesNoLabel(value: boolean | null, es: boolean): string {
  if (value === null) return '—';
  if (value) return es ? 'Sí' : 'Yes';
  return 'No';
}

// ─── Summary strip ──────────────────────────────────────────────────────────

export interface CooperativaStripItem {
  readonly key: string;
  readonly label: string;
  /** null → MetricStrip renders `—` (D1: never a fabricated 0). */
  readonly value: number | null;
  readonly unit: 'USD_M' | 'ratio' | 'count';
}

/**
 * Build the allowance-summary strip. When the backend reports
 * `data_unavailable` every numeric is `null` so the strip shows `—` rather than
 * the zero sentinels — the methodology provenance is shown separately.
 */
export function buildCooperativaStripItems(
  data: CooperativaCECLResult,
  es: boolean,
): readonly CooperativaStripItem[] {
  const unavailable = isCooperativaDataUnavailable(data);
  return [
    { key: 'total_balance', label: es ? 'Balance Total' : 'Total Balance', value: unavailable ? null : data.totalBalance, unit: 'USD_M' },
    { key: 'total_allowance', label: es ? 'Provisión Total' : 'Total Allowance', value: unavailable ? null : data.totalAllowance, unit: 'USD_M' },
    { key: 'coverage', label: es ? 'Cobertura' : 'Coverage', value: unavailable ? null : data.weightedCoverageRatio, unit: 'ratio' },
    { key: 'eligible_segments', label: es ? 'Segmentos Elegibles' : 'Eligible Segments', value: unavailable ? null : data.segments.length, unit: 'count' },
  ];
}

// ─── Data-gap tally ─────────────────────────────────────────────────────────

export interface GapSeverityCounts {
  readonly critical: number;
  readonly warning: number;
}

/** Tally gaps by severity for the <DataGapBanner> summary line. */
export function countGapSeverities(
  gaps: readonly DataGap[] | undefined,
): GapSeverityCounts {
  let critical = 0;
  let warning = 0;
  for (const g of gaps ?? []) {
    if (g.severity === 'CRITICAL') critical += 1;
    else if (g.severity === 'WARNING') warning += 1;
  }
  return { critical, warning };
}

// ─── PR macro overlay disclosure (configuration, not data) ──────────────────

export interface OverlayScenarioDisclosure {
  readonly key: 'baseline' | 'adverse' | 'severely_adverse';
  readonly es: string;
  readonly en: string;
  /** Scenario PD multiplier — mirrors PR_PD_MULTIPLIERS in the registry. */
  readonly pdMultiplier: number;
  /** Scenario probability weight (percent) — mirrors PR_SCENARIO_WEIGHTS. */
  readonly weightPct: number;
}

/**
 * The disclosed PR macro overlay knobs the disclosure card renders. These are
 * DISCLOSED CONFIGURATION, not measured institution data — hence the card title
 * "Recargo Macro PR (configuración divulgada, no datos)". Multipliers
 * (1.0/2.1/3.6) and weights (45/35/20) mirror PR_PD_MULTIPLIERS /
 * PR_SCENARIO_WEIGHTS in backend product-registry.ts.
 */
export const PR_OVERLAY_DISCLOSURE: readonly OverlayScenarioDisclosure[] = [
  { key: 'baseline', es: 'Base', en: 'Baseline', pdMultiplier: 1.0, weightPct: 45 },
  { key: 'adverse', es: 'Adverso', en: 'Adverse', pdMultiplier: 2.1, weightPct: 35 },
  { key: 'severely_adverse', es: 'Severamente Adverso', en: 'Severely Adverse', pdMultiplier: 3.6, weightPct: 20 },
];

/**
 * Cold-start disclosure — shown whenever registry PD/LGD defaults were applied.
 * Mirrors the Spanish gap action emitted by the backend so the page and the
 * engine speak with one voice.
 */
export const COLD_START_NOTE = {
  es: 'Calibración provisional — cargue el historial de pérdidas de la cooperativa para una estimación definitiva.',
  en: 'Provisional calibration — load the cooperativa loss history for a definitive estimate.',
} as const;
