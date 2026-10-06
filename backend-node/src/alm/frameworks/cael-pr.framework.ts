/**
 * CAEL — Puerto Rico Cooperativa Regulatory Filing Framework (COSSEC)
 *
 * CAEL = Capital · Asset quality · Earnings · Liquidity (the cooperativa
 * analogue of NCUA's CAMEL, dropping the "M" — Management — which COSSEC
 * assesses qualitatively, not via a filed ratio).
 *
 * Since March 2024 every PR cooperativa files THREE parallel CAEL reports
 * quarterly through AITSA (market research notes §3.2):
 *
 *   1. `cael-pr-7790`   — CAEL per Reglamento 7790, allowance on the legacy
 *                         INCURRED-LOSS basis (Reglamento 8665 §2.12.2.5).
 *   2. `cael-pr-cecl`   — CAEL with the allowance computed under CECL
 *                         (Carta Circular 2023-01 / ASC 326).
 *   3. `cael-pr-piloto` — "CAEL Piloto": the Net Equity Ratio pilot index
 *                         (equity ÷ total assets) phasing toward a 4% floor
 *                         (market research notes §3.5).
 *
 * This module is the DECLARATIVE half of W1.1 — the ratio dictionary the three
 * variants share. The COMPUTATION half (a `calculateCAELCompliance()` that
 * evaluates these ratios on a real balance sheet, plus the dual-output filing
 * renderer) lands in Slice 2; it reuses the existing COSSEC C/A/E/L math and the
 * {@link CECLService.calculateIncurredLoss} / `calculateWARM` allowance legs.
 *
 * DISCLOSED CONFIG (D1): the CAEL composite weighting and the rating bands are
 * UNVERIFIED — the operative Reglamento 7790 text and CC-2023-01 are non-OCR
 * scans (market research notes §9 items 3–4). Every ratio carries an honest `source` and
 * a `provisional` flag so the compute layer (Slice 2) can emit a WARNING gap for
 * provisional thresholds rather than presenting them as verified figures. Where a
 * threshold IS statutorily grounded (Ley 255 capital 8%, CC-2021-02 liquidity
 * 5%) it is marked `provisional: false` with its citation.
 */

import {
  IRegulatoryFramework,
  RegulatoryRatio,
} from './regulatory-framework.interface';

/** Which of the three quarterly CAEL report variants a framework models. */
export type CaelVariant = 'reg7790' | 'cecl' | 'piloto';

/** The allowance measurement basis used by a CAEL variant's asset-quality leg. */
export type CaelLossBasis = 'incurred-loss' | 'cecl' | 'n/a';

/**
 * A CAEL ratio is a {@link RegulatoryRatio} plus provenance: which circular it
 * derives from and whether its threshold is provisional (UNVERIFIED reg text).
 * Extending here keeps the shared interface untouched while making each CAEL
 * threshold self-documenting for the Slice-2 disclosure gap.
 */
export interface CaelRatio extends RegulatoryRatio {
  /** Regulatory source / circular this threshold derives from. */
  source: string;
  /** True when the threshold is PROVISIONAL config pending COSSEC validation. */
  provisional: boolean;
}

/** A CAEL filing framework: an {@link IRegulatoryFramework} with variant metadata. */
export interface CaelFramework extends IRegulatoryFramework {
  ratios: CaelRatio[];
  /** Which of the three quarterly CAEL report variants this models. */
  variant: CaelVariant;
  /** Allowance measurement basis for the asset-quality leg. */
  lossBasis: CaelLossBasis;
  /** Bilingual provenance note surfaced on the filing + as the disclosure gap. */
  provenance: string;
}

// ─── Shared CAEL ratio legs (Asset quality / Earnings / Liquidity) ───
//
// These three legs are identical across the three variants; only the Capital
// leg and the loss basis differ. Defined once and spread into each variant so
// they cannot drift apart silently.

const ASSET_QUALITY_LEG: CaelRatio = {
  id: 2,
  name: 'Asset Quality (Delinquency + Allowance Coverage)',
  nameEs: 'Calidad de Activos (Morosidad + Cobertura de Provisión)',
  category: 'asset_quality',
  threshold: '<= 3%',
  thresholdDirection: 'lte',
  weight: 30,
  source: 'Reglamento 7790 (CAEL bands UNVERIFIED — non-OCR scan)',
  provisional: true,
};

const EARNINGS_LEG: CaelRatio = {
  id: 3,
  name: 'Earnings (Return on Assets)',
  nameEs: 'Rentabilidad (Retorno sobre Activos)',
  category: 'earnings',
  threshold: '>= 0.5%',
  thresholdDirection: 'gte',
  weight: 20,
  source: 'Reglamento 7790 (CAEL bands UNVERIFIED — non-OCR scan)',
  provisional: true,
};

const LIQUIDITY_LEG: CaelRatio = {
  id: 4,
  name: 'Liquidity Ratio',
  nameEs: 'Razón de Liquidez',
  category: 'liquidity',
  // Statutorily grounded: CC-2021-02 sets a 5% minimum liquidity floor.
  threshold: '>= 5%',
  thresholdDirection: 'gte',
  weight: 20,
  source: 'Carta Circular CC-2021-02 (5% minimum liquidity)',
  provisional: false,
};

// ─── Capital legs (the variant-distinguishing ratio) ───

/** Indivisible-capital-over-RWA capital adequacy (Ley 255-2002 Art. 6.02). */
const CAPITAL_LEG_INDIVISIBLE: CaelRatio = {
  id: 1,
  name: 'Capital Adequacy (Indivisible Capital / RWA)',
  nameEs: 'Suficiencia de Capital (Capital Indivisible / APR)',
  category: 'capital',
  threshold: '>= 8%',
  thresholdDirection: 'gte',
  weight: 30,
  source: 'Ley 255-2002 Art. 6.02 (8% indivisible capital over RWA)',
  provisional: false,
};

/** Net Equity Ratio = equity ÷ total assets (simple leverage), CAEL Piloto. */
const CAPITAL_LEG_NET_EQUITY: CaelRatio = {
  id: 1,
  name: 'Net Equity Ratio (Equity / Total Assets)',
  nameEs: 'Razón de Patrimonio Neto (Patrimonio / Activos Totales)',
  category: 'capital',
  // Phasing toward a 4% floor (market research notes §3.5). NOT the RWA-based ratio.
  threshold: '>= 4%',
  thresholdDirection: 'gte',
  weight: 30,
  source:
    'CAEL Piloto — 4% Net Equity phase-in (market research notes §3.5, UNVERIFIED)',
  provisional: true,
};

// ─── The three CAEL filing frameworks ───

/** CAEL per Reglamento 7790 — allowance on the legacy incurred-loss basis. */
export const CAEL_PR_7790_FRAMEWORK: CaelFramework = {
  id: 'cael-pr-7790',
  name: 'CAEL (Reglamento 7790)',
  nameEs: 'CAEL (Reglamento 7790)',
  regulator: 'COSSEC',
  country: 'PR',
  currency: 'USD',
  variant: 'reg7790',
  lossBasis: 'incurred-loss',
  ratios: [
    CAPITAL_LEG_INDIVISIBLE,
    ASSET_QUALITY_LEG,
    EARNINGS_LEG,
    LIQUIDITY_LEG,
  ],
  examFrequency: 'Quarterly',
  provenance:
    'CAEL base por Reglamento 7790; provisión en base de pérdida incurrida (Reg 8665 §2.12.2.5). / CAEL base per Reg 7790; allowance on the incurred-loss basis (Reg 8665 §2.12.2.5).',
};

/** CAEL with the allowance computed under CECL (CC-2023-01 / ASC 326). */
export const CAEL_PR_CECL_FRAMEWORK: CaelFramework = {
  id: 'cael-pr-cecl',
  name: 'CAEL with CECL',
  nameEs: 'CAEL con CECL',
  regulator: 'COSSEC',
  country: 'PR',
  currency: 'USD',
  variant: 'cecl',
  lossBasis: 'cecl',
  ratios: [
    CAPITAL_LEG_INDIVISIBLE,
    ASSET_QUALITY_LEG,
    EARNINGS_LEG,
    LIQUIDITY_LEG,
  ],
  examFrequency: 'Quarterly',
  provenance:
    'CAEL con cómputo CECL (Carta Circular 2023-01, ASC 326). / CAEL with CECL computation (Carta Circular 2023-01, ASC 326).',
};

/** "CAEL Piloto" — the Net Equity Ratio pilot index (equity / total assets). */
export const CAEL_PR_PILOTO_FRAMEWORK: CaelFramework = {
  id: 'cael-pr-piloto',
  name: 'CAEL Piloto (Net Equity Ratio)',
  nameEs: 'CAEL Piloto (Razón de Patrimonio Neto)',
  regulator: 'COSSEC',
  country: 'PR',
  currency: 'USD',
  variant: 'piloto',
  lossBasis: 'n/a',
  ratios: [
    CAPITAL_LEG_NET_EQUITY,
    ASSET_QUALITY_LEG,
    EARNINGS_LEG,
    LIQUIDITY_LEG,
  ],
  examFrequency: 'Quarterly',
  provenance:
    'CAEL Piloto: índice de Razón de Patrimonio Neto (patrimonio ÷ activos) en transición hacia un piso de 4%. / CAEL Piloto: Net Equity Ratio index (equity ÷ assets) phasing toward a 4% floor.',
};

/** All three CAEL variants, keyed by variant for the dual/triple-filing pipeline. */
export const CAEL_PR_FRAMEWORKS: Record<CaelVariant, CaelFramework> = {
  reg7790: CAEL_PR_7790_FRAMEWORK,
  cecl: CAEL_PR_CECL_FRAMEWORK,
  piloto: CAEL_PR_PILOTO_FRAMEWORK,
};

/** Resolve one of the three CAEL filing frameworks by variant. */
export function getCaelFramework(variant: CaelVariant): CaelFramework {
  return CAEL_PR_FRAMEWORKS[variant];
}
