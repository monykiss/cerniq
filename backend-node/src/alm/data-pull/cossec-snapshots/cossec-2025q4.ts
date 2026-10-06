/**
 * COSSEC curated snapshots — Tier-1 Puerto Rico Cooperativas
 *
 * SOURCE OF TRUTH
 * ───────────────
 * Assets / members from COSSEC Anejo 9 (Q2 2025 extract in
 * `src/alm/data/registry/pr-cooperativas-q2-2025.json`). Ratio fields use
 * sector-median fillers where per-coop public ratios are not committed —
 * every generated report discloses that.
 *
 * DISCLOSURE
 * ──────────
 * Every PDF generated from this snapshot carries a footer reading:
 *   "PRELIMINARY — Built from COSSEC public filings, [asOfQuarter]"
 */

import { listPrCooperativas } from '../../data/registry/pr-cooperativas.registry';

export interface CossecCooperativaSnapshot {
  /** Stable slug used as publicDataIdentifier on ProspectInstitution */
  slug: string;
  /** Legal / display cooperativa name */
  name: string;
  /** Municipality */
  city: string;
  /** Total assets in USD (full dollars, not millions) */
  totalAssets: number;
  /** Membership count */
  members: number;
  /** Net worth ratio (capital / total assets) as a percentage, e.g. 9.4 means 9.4% */
  capitalRatioPct: number;
  /** Loans / deposits ratio as a percentage */
  loanToDepositPct: number;
  /** Liquid assets / total assets as a percentage */
  liquidityRatioPct: number;
  /** Net interest income margin as a percentage */
  niiMarginPct: number;
  /** YoY asset growth as a percentage */
  assetGrowthYoyPct: number;
  /** Quarter the snapshot represents (e.g. "Q2-2025") */
  asOfQuarter: string;
  /** Free-text provenance — what we sourced from where */
  provenance: string;
}

/** Slug overrides for demo-seat / free-report callers that key by name. */
const SLUG_BY_CHARTER: Record<string, string> = {
  '007': 'rincon',
  '283': 'coopaca',
  '144': 'credicentro',
  '148': 'las-piedras',
  '038': 'oriental',
  '002': 'isabela',
  '015': 'vega-alta',
  '016': 'camuy',
  '023': 'cabo-rojo',
  '035': 'sagrada-familia',
  '100': 'manati',
  '019': 'san-jose',
  '012': 'medi-coop',
  '225': 'villalba',
  '098': 'zeno-gandia',
  '176': 'roosevelt-roads',
  '058': 'maunacoop',
  '112': 'candelcoop',
  '193': 'larcoop',
  '021': 'quebradillas',
  '092': 'caguas',
  '206': 'mayaguez',
};

const SECTOR_FILLERS = {
  capitalRatioPct: 9.2,
  loanToDepositPct: 72.5,
  liquidityRatioPct: 22.1,
  niiMarginPct: 3.8,
  assetGrowthYoyPct: 4.2,
};

/** Charters that free-report / demo-seat tests resolve by slug (must stay present). */
const DEMO_SLUG_CHARTERS = new Set(Object.keys(SLUG_BY_CHARTER));

function toSnapshot(row: {
  cossecCharter: string;
  seedKey: string;
  displayName: string;
  hqMunicipality: string;
  totalAssetsUsd: number;
  members: number;
  asOf: string;
}): CossecCooperativaSnapshot {
  return {
    slug:
      SLUG_BY_CHARTER[row.cossecCharter] ??
      row.seedKey.replace(/^pr-cossec-/, ''),
    name: row.displayName,
    city: `${row.hqMunicipality}, PR`,
    totalAssets: row.totalAssetsUsd,
    members: row.members,
    ...SECTOR_FILLERS,
    asOfQuarter: 'Q2-2025',
    provenance: `COSSEC Anejo 9 ${row.asOf} (charter ${row.cossecCharter}); ratio fields = sector medians`,
  };
}

function buildTier1Snapshots(): CossecCooperativaSnapshot[] {
  const all = listPrCooperativas();
  // Top-20 by assets + any demo-slug anchors outside that cut (e.g. Caguas Coop).
  const top20 = all.slice(0, 20);
  const extras = all.filter(
    (row) =>
      DEMO_SLUG_CHARTERS.has(row.cossecCharter) &&
      !top20.some((t) => t.cossecCharter === row.cossecCharter),
  );
  return [...top20, ...extras].map(toSnapshot);
}

export const COSSEC_SNAPSHOT_2025Q4: CossecCooperativaSnapshot[] =
  buildTier1Snapshots();

export const COSSEC_SNAPSHOT_BY_SLUG: Map<string, CossecCooperativaSnapshot> =
  new Map(COSSEC_SNAPSHOT_2025Q4.map((entry) => [entry.slug, entry]));
