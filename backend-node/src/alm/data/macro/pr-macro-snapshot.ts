/**
 * Committed PR macro snapshot — the data source for the W1.2 macro overlay
 * (`PrMacroFeedService` → `MacroOverlayService.deriveCurrentOverlay`).
 *
 * WHY A TS MODULE, NOT JSON: `nest build` copies no assets (nest-cli.json has
 * no `assets` config), so a `readFileSync` fixture would silently vanish from
 * `dist/`. A typed const compiles into the bundle, is shape-checked by tsc,
 * and keeps the sourcing note in the same reviewed diff as the numbers —
 * changing a regulated calibration input goes through review + CI exactly
 * like changing the constants it replaces. (Same pattern as the fixtures
 * loader's GENERATED_FIXTURES.)
 *
 * REFRESH PROTOCOL (operator): re-verify each series against its sourceUrl,
 * update `value`/`asOf`/`note`, bump `compiledAsOf` to the verification date,
 * and let the golden + bounds specs re-run. Cadence: quarterly (market research notes
 * §5 — aligned to COSSEC statistical publication). Past
 * `PR_MACRO_STALENESS_DAYS` (default 120) the feed emits a STALE_SNAPSHOT
 * WARNING gap but keeps serving the data (D1: partial + disclosed, never
 * refuse).
 */

export interface PrMacroSeriesProvenance {
  /** Which `PrMacroInputs` field this series feeds. */
  field: 'prUnemploymentPct' | 'prHpiYoyPct' | 'prNetMigrationPct';
  value: number;
  /** Period the VALUE describes (not the publication date). */
  asOf: string;
  source: string;
  seriesId: string;
  sourceUrl: string;
  note: string;
}

export interface PrMacroSnapshotData {
  snapshotKey: 'pr-macro-snapshot';
  /**
   * Date the snapshot was COMPILED + cross-verified against live sources.
   * Staleness is measured against this (how old is the last verification
   * pass), not against per-series asOf — series lag differently by design
   * (LAUS monthly, FHFA quarterly, Census annual); per-series ages are
   * disclosed in the provenance entries.
   */
  compiledAsOf: string;
  inputs: {
    prUnemploymentPct: number;
    prHpiYoyPct: number;
    prNetMigrationPct: number;
  };
  series: PrMacroSeriesProvenance[];
  verificationNote: string;
}

export const PR_MACRO_SNAPSHOT: PrMacroSnapshotData = {
  snapshotKey: 'pr-macro-snapshot',
  compiledAsOf: '2026-07-09',
  inputs: {
    prUnemploymentPct: 5.6,
    prHpiYoyPct: 14.95,
    prNetMigrationPct: -0.09,
  },
  series: [
    {
      field: 'prUnemploymentPct',
      value: 5.6,
      asOf: '2026-05',
      source:
        'BLS Local Area Unemployment Statistics (LAUS), PR statewide unemployment rate, seasonally adjusted',
      seriesId:
        'FRED:PRURN (canonical). Raw BLS series-ID form (LAUST72… vs LASST72…) is UNRESOLVED — market research notes §10.2; resolve via the BLS Series-ID builder before wiring raw BLS ingest. Live refresh therefore uses FRED PRURN.',
      sourceUrl: 'https://fred.stlouisfed.org/series/PRURN',
      note: 'May 2026 print, stable vs April (~69,000 unemployed persons).',
    },
    {
      field: 'prHpiYoyPct',
      value: 14.95,
      asOf: '2025-Q4',
      source:
        'FHFA all-transactions house price index, Puerto Rico (developmental territory series)',
      seriesId: 'FHFA HPI datasets — PR quarterly all-transactions',
      sourceUrl: 'https://www.fhfa.gov/data/hpi/datasets',
      note: 'Latest YoY print computable in the 2026-07-09 verification pass. The Q1-2026 index level (270.34, from 247.97 in Q4-2025) is published but the Q1-2025 level was not retrievable, so its YoY is not computed. Series is volatile quarter-to-quarter (2025 YoY prints: +21.55 / +12.98 / +2.55 / +14.95); any value above the +3.0 reference contributes zero macro stress, so this volatility does not move the overlay.',
    },
    {
      field: 'prNetMigrationPct',
      value: -0.09,
      asOf: '2025-07-01',
      source:
        'US Census Bureau Vintage 2025 population estimates, PR components of change',
      seriesId: 'Census PEP Vintage 2025 (FIPS 72)',
      sourceUrl:
        'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-puerto-rico.html',
      note: 'Net migration −2,779 on 3,184,835 residents (Jul 2024 → Jul 2025) = −0.087%, rounded to −0.09. The total population decline (−17,686) was dominated by natural change (−14,907), not migration.',
    },
  ],
  verificationNote:
    'Compiled + cross-verified 2026-07-09 from live public sources (see sourceUrl per series). All three inputs are at-or-better than PR_MACRO_REFERENCE (6.0% unemployment / +3.0% HPI / −1.0% migration) → macro-stress index 0 → the derived overlay reduces exactly to the provisional base constants (adverse 2.1×, severe 3.6×; weights 45/35/20). The overlay is stress-only: it rises above the base under worse-than-reference macro, never softens below it.',
};
