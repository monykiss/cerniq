/**
 * COSSEC compliance page — pure helpers.
 *
 * Kept separate from `page.tsx` so the D1-critical logic (response validation,
 * the overall semáforo mapping, and the honest `—` rendering for
 * `data_unavailable` ratios) is unit-tested without rendering React. The page
 * is a thin shell over these.
 *
 * Backend contract: `GET /api/alm/{id}/cossec-compliance` →
 * `COSSECComplianceResult` (see alm-enterprise.service.ts). When inputs are
 * incomplete the engine returns `overallStatus: 'data_unavailable'` + a
 * `gaps[]` manifest and each ratio carries `status: 'data_unavailable'` with a
 * `value: 0` SENTINEL — never a real measured zero. `formatRatioValue` is the
 * frontend half of that D1 contract.
 */

import type { DataGap } from '@/hooks/useReportDataGaps';

export type CossecOverallStatus =
  | 'compliant'
  | 'conditional'
  | 'non-compliant'
  | 'data_unavailable';

export type CossecRatioStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'info'
  | 'data_unavailable';

export type SemaforoTone = 'green' | 'amber' | 'red' | 'gray';

export interface CossecRatio {
  readonly id: number;
  readonly name: string;
  readonly nameEs: string;
  readonly value: number;
  readonly unit: string;
  readonly threshold: string;
  readonly status: CossecRatioStatus;
  readonly description: string;
  readonly descriptionEs: string;
}

export interface CossecComplianceResult {
  readonly institutionName?: string;
  readonly reportingDate?: string;
  readonly overallStatus: CossecOverallStatus;
  readonly examReadinessScore: number;
  readonly ratios: readonly CossecRatio[];
  readonly gaps?: DataGap[];
  readonly summary: {
    readonly capitalRatio: number;
    readonly capitalRatioRWA?: number;
    readonly loanToShareRatio: number;
    readonly liquidityRatio: number;
    readonly nim: number;
  };
}

/**
 * Trust-but-verify the response shape. Throws (→ AlmPage error state) on a
 * structural mismatch; never silently coerces.
 */
export function validateCossec(raw: unknown): CossecComplianceResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('COSSEC response must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.overallStatus !== 'string') {
    throw new Error('COSSEC: missing overallStatus');
  }
  if (!Array.isArray(r.ratios)) {
    throw new Error('COSSEC: ratios must be an array');
  }
  if (!r.summary || typeof r.summary !== 'object') {
    throw new Error('COSSEC: missing summary');
  }
  return r as unknown as CossecComplianceResult;
}

export interface BannerSpec {
  readonly es: string;
  readonly en: string;
  readonly tone: SemaforoTone;
}

/**
 * Overall semáforo banner — Spanish-first labels a Presidente Ejecutivo reads
 * without training. `data_unavailable` is its own neutral state (gray) so an
 * empty upload never reads as a pass or a breach.
 */
export function overallBanner(status: CossecOverallStatus): BannerSpec {
  switch (status) {
    case 'compliant':
      return { es: 'CUMPLE', en: 'COMPLIANT', tone: 'green' };
    case 'conditional':
      return {
        es: 'CUMPLE CON OBSERVACIONES',
        en: 'COMPLIANT WITH OBSERVATIONS',
        tone: 'amber',
      };
    case 'non-compliant':
      return { es: 'NO CUMPLE', en: 'NON-COMPLIANT', tone: 'red' };
    case 'data_unavailable':
      return { es: 'DATOS INSUFICIENTES', en: 'INSUFFICIENT DATA', tone: 'gray' };
  }
}

/** Per-ratio semáforo tone. */
export function ratioTone(status: CossecRatioStatus): SemaforoTone {
  switch (status) {
    case 'pass':
      return 'green';
    case 'warning':
      return 'amber';
    case 'fail':
      return 'red';
    case 'info':
    case 'data_unavailable':
      return 'gray';
  }
}

/** Bilingual per-ratio status label. */
export function ratioStatusLabel(status: CossecRatioStatus, es: boolean): string {
  switch (status) {
    case 'pass':
      return es ? 'Cumple' : 'Pass';
    case 'warning':
      return es ? 'Observación' : 'Warning';
    case 'fail':
      return es ? 'No cumple' : 'Fail';
    case 'info':
      return es ? 'Informativo' : 'Info';
    case 'data_unavailable':
      return es ? 'Datos pendientes' : 'Data pending';
  }
}

/**
 * Render a ratio value honestly. D1: a `data_unavailable` ratio carries a `0`
 * sentinel that is NOT a real number — show `—`, never `0`.
 */
export function formatRatioValue(
  r: Pick<CossecRatio, 'value' | 'unit' | 'status'>,
): string {
  if (r.status === 'data_unavailable') return '—';
  const v = r.value;
  const u = r.unit;
  if (u === '%' || u === 'pct') return `${v.toFixed(2)}%`;
  if (u === 'x' || u === 'ratio') return `${v.toFixed(2)}×`;
  if (u === 'USD_M' || u === '$M') return `$${v.toFixed(1)}M`;
  return u ? `${v.toFixed(2)} ${u}` : v.toFixed(2);
}

export interface RatioCounts {
  readonly pass: number;
  readonly warning: number;
  readonly fail: number;
  readonly unavailable: number;
}

/** Count ratios by status for the semáforo summary strip. */
export function countRatioStatuses(
  ratios: readonly CossecRatio[],
): RatioCounts {
  let pass = 0;
  let warning = 0;
  let fail = 0;
  let unavailable = 0;
  for (const r of ratios) {
    if (r.status === 'pass') pass++;
    else if (r.status === 'warning') warning++;
    else if (r.status === 'fail') fail++;
    else if (r.status === 'data_unavailable') unavailable++;
  }
  return { pass, warning, fail, unavailable };
}
