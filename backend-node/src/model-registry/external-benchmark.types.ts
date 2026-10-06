/**
 * External benchmark validation types — FAANG Audit P2.
 *
 * Enterprise-grade model governance requires comparing production models
 * against named authoritative external sources (Fed H.15, FFIEC UBPR,
 * COSSEC circulars, NCUA 5300 aggregates, FRB CCAR). This file defines
 * the contract; `external-benchmark-validator.service.ts` implements it.
 *
 * Distinction from golden tests:
 *   - Golden tests pin internal output (drift detection vs our own prior run).
 *   - External benchmarks pin our output to a third-party ground truth.
 *
 * Every artifact produced by the validator is persisted as a
 * `ModelValidationArtifact` with `artifactType: 'benchmark'`, so the
 * audit trail lives alongside golden tests in the same Prisma table.
 */

/** Named authoritative sources. Extend deliberately — each entry becomes
 *  a citable source on the examiner-facing artifact row. */
export type ExternalBenchmarkSource =
  | 'FED_H15' //               https://www.federalreserve.gov/releases/h15/
  | 'FFIEC_UBPR' //             https://cdr.ffiec.gov/public/ManageFacsimiles.aspx
  | 'COSSEC_CIRCULAR' //        https://www.cossec.pr.gov/publicaciones/
  | 'NCUA_5300_AGGREGATE' //    https://www.ncua.gov/analysis/cuso-economic-data/credit-union-data/reports-call-reports
  | 'FRB_CCAR' //               https://www.federalreserve.gov/supervisionreg/ccar.htm
  | 'FHLB_ADVANCE_RATES' //     https://www.fhlbanks.com/
  | 'BIS_BCBS'; //              https://www.bis.org/bcbs/

export type BenchmarkUnits =
  | 'percent' //          5.25 means 5.25%
  | 'basis_points' //     25 means 25bp = 0.25%
  | 'ratio' //            1.18 means 118%
  | 'decimal' //          0.055 means 5.5%
  | 'usd_millions' //     1250 means $1.25B
  | 'years'; //           duration, maturity

export interface ExternalBenchmark {
  /** Stable id. Convention: `<source>.<metric>.<asOfDate>` */
  id: string;
  source: ExternalBenchmarkSource;
  /** Deep-link to the exact release/page, not the source root. */
  sourceUrl: string;
  /** ISO YYYY-MM-DD. The as-of date of the published figure. */
  asOfDate: string;
  /** Source-native metric name, e.g. `treasury_10y_par_yield`, `peer_median_nim`. */
  metric: string;
  /** The authoritative expected value. */
  expectedValue: number;
  units: BenchmarkUnits;
  /** Which registry model this benchmark anchors. Must match `modelKey`. */
  modelKey: string;
  /** Human-readable one-liner used in admin UI and artifact labels. */
  description: string;
  /** Optional: describe how to reproduce the inputs that yield expectedValue. */
  reproduction?: string;
}

/** Per-model tolerance policy. Drives pass/fail and failure action.
 *  Populated by `external-benchmark-tolerances.ts`. */
export interface Tolerance {
  /** Absolute drift cap in the benchmark's native units. Null = no abs gate. */
  absolute: number | null;
  /** Relative drift cap (fraction, e.g. 0.01 = 1%). Null = no rel gate. */
  relative: number | null;
  /** What happens when the model falls outside tolerance.
   *  - WARN: record artifact, emit DataGap, do nothing else.
   *  - BLOCK_APPROVAL: registry service refuses to transition to APPROVED while a
   *                    recent benchmark artifact is failing.
   *  - AUTO_DEPRECATE: on repeated failure, flip model to DEPRECATED with reason. */
  onFailure: 'WARN' | 'BLOCK_APPROVAL' | 'AUTO_DEPRECATE';
}

export interface ValidationInput {
  modelKey: string;
  /** Observed value produced by calling the model with benchmark-consistent inputs.
   *  Null when the model legitimately returns data_unavailable — this is NOT a failure,
   *  it surfaces as a DataGap. */
  observed: number | null;
  /** Which benchmark to compare against. Use `listBenchmarks()` to enumerate. */
  benchmarkId: string;
  /** Caller identity for audit trail (e.g. `nightly-cron`, `admin:user@cerniq.io`, `spec`). */
  producedBy: string;
}

export interface ValidationOutcome {
  benchmarkId: string;
  source: ExternalBenchmarkSource;
  sourceUrl: string;
  modelKey: string;
  observed: number | null;
  expected: number;
  /** `observed - expected`; null when observed is null. */
  absDelta: number | null;
  /** `(observed - expected) / |expected|`; null when observed is null or expected is 0. */
  relDelta: number | null;
  tolerance: Tolerance;
  /** true = within tolerance, false = outside, null = could not be computed (observed null). */
  passed: boolean | null;
  /** `ModelValidationArtifact.id` — null only when model was not found in registry. */
  artifactId: string | null;
  ranAt: string;
  /** Non-empty when `observed` is null or a critical input was missing. */
  gaps: Array<{
    field: string;
    reason: string;
    severity: 'CRITICAL' | 'WARNING';
    action: string;
  }>;
}
