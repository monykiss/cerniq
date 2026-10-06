/**
 * Product mapping — free-text product label → canonical CooperativaProductType.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two different surfaces carry a product label as free text:
 *
 *   * `LoanRecord.segmentName` — whatever the institution's core system wrote
 *     on the loan tape ("Auto", "AUTO LOAN", "Préstamos de auto", "hipotecario").
 *   * `MemberAccount.productType` — the Member 360 label ("préstamo de auto").
 *
 * `product-registry.ts` is the canonical taxonomy and holds the PD/LGD, CECL
 * eligibility and balance-sheet subcategory for each product. Neither free-text
 * field could reach it, so a member's auto loan could not be joined to its own
 * PD — the `MemberAccount.productType` doc comment predicted exactly this
 * drift ("meant to roll up into it in the aggregation service"). This module is
 * that roll-up, in one place, so the two surfaces cannot drift apart again.
 *
 * D1 — NEVER GUESS
 * ----------------
 * An unrecognized label returns `null`, not a "closest match" and not a default
 * bucket. Silently mapping an unknown label onto, say, PRESTAMO_PERSONAL would
 * assign that loan a 2.5% PD and a 65% LGD it was never measured to have, and
 * the resulting CECL number would look authoritative. `null` forces the caller
 * to disclose the gap (`PRODUCT_TYPE_UNMAPPED`) instead.
 *
 * NO FUZZY MATCHING — AND ONE REAL COLLISION
 * ------------------------------------------
 * Substring matching is unsafe here because the taxonomy contains a genuine
 * overlap: "préstamo con garantía de acciones" (a share-SECURED LOAN, an asset,
 * PD 0.3%) contains the token "acciones", which on its own means share savings
 * (a LIABILITY, no PD at all). A naive `includes('acciones')` maps a loan to a
 * deposit product and moves it to the wrong side of the balance sheet.
 *
 * So matching is strictly two-phase:
 *   1. exact match on a normalized synonym table (the only path most labels
 *      take), then
 *   2. an ORDERED token-rule list where the more specific rule is always
 *      evaluated first. Order is load-bearing and asserted by the spec.
 */

import {
  COOPERATIVA_PRODUCT_REGISTRY,
  COOPERATIVA_PRODUCT_TYPES,
  type CooperativaProductType,
} from './product-registry';

/**
 * Normalizes a label for comparison: lowercase, accents stripped, punctuation
 * reduced to single spaces, trimmed.
 *
 * Accent stripping matters more than it looks — PR core systems emit
 * "préstamo", "prestamo" and "PRÉSTAMO" for the same product depending on the
 * export encoding, and a tape that lost its accents in a Latin-1 round trip
 * must still map.
 */
/**
 * Unicode combining-diacritical-marks block (U+0300–U+036F), built from a
 * string so this source file stays pure ASCII. A literal accent range here is
 * invisible in diffs and easy to mangle on a non-UTF-8 checkout.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeProductLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Exact-match synonym table, keyed by NORMALIZED label.
 *
 * Every canonical code is registered as its own synonym (both the raw code and
 * its normalized form), so an already-canonical value passes through unchanged
 * and re-mapping is idempotent.
 */
const EXACT_SYNONYMS: Readonly<Record<string, CooperativaProductType>> = {
  // ── PRESTAMO_PERSONAL ──
  'prestamo personal': 'PRESTAMO_PERSONAL',
  'prestamos personales': 'PRESTAMO_PERSONAL',
  'personal loan': 'PRESTAMO_PERSONAL',
  'personal loans': 'PRESTAMO_PERSONAL',
  personal: 'PRESTAMO_PERSONAL',
  consumo: 'PRESTAMO_PERSONAL',
  'prestamo de consumo': 'PRESTAMO_PERSONAL',
  unsecured: 'PRESTAMO_PERSONAL',

  // ── PRESTAMO_AUTO ──
  'prestamo de auto': 'PRESTAMO_AUTO',
  'prestamos de auto': 'PRESTAMO_AUTO',
  'prestamo auto': 'PRESTAMO_AUTO',
  'auto loan': 'PRESTAMO_AUTO',
  'auto loans': 'PRESTAMO_AUTO',
  auto: 'PRESTAMO_AUTO',
  vehiculo: 'PRESTAMO_AUTO',
  'prestamo de vehiculo': 'PRESTAMO_AUTO',
  vehicle: 'PRESTAMO_AUTO',
  'vehicle loan': 'PRESTAMO_AUTO',

  // ── HIPOTECA ──
  hipoteca: 'HIPOTECA',
  hipotecas: 'HIPOTECA',
  hipotecario: 'HIPOTECA',
  'prestamo hipotecario': 'HIPOTECA',
  mortgage: 'HIPOTECA',
  mortgages: 'HIPOTECA',
  'residential mortgage': 'HIPOTECA',
  'residential mortgages': 'HIPOTECA',
  'real estate': 'HIPOTECA',

  // ── PRESTAMO_COMERCIAL (MBL — member business loan) ──
  'prestamo comercial': 'PRESTAMO_COMERCIAL',
  'prestamos comerciales': 'PRESTAMO_COMERCIAL',
  comercial: 'PRESTAMO_COMERCIAL',
  commercial: 'PRESTAMO_COMERCIAL',
  'commercial loan': 'PRESTAMO_COMERCIAL',
  'commercial loans': 'PRESTAMO_COMERCIAL',
  mbl: 'PRESTAMO_COMERCIAL',
  'member business loan': 'PRESTAMO_COMERCIAL',
  'member business loans': 'PRESTAMO_COMERCIAL',
  'prestamo comercial mbl': 'PRESTAMO_COMERCIAL',
  business: 'PRESTAMO_COMERCIAL',
  'business loan': 'PRESTAMO_COMERCIAL',
  // C&I is the mainland term for the same exposure a PR coop books as an MBL.
  'c i': 'PRESTAMO_COMERCIAL',
  ci: 'PRESTAMO_COMERCIAL',
  'commercial and industrial': 'PRESTAMO_COMERCIAL',
  'commercial industrial': 'PRESTAMO_COMERCIAL',
  industrial: 'PRESTAMO_COMERCIAL',

  // ── PRESTAMO_GARANTIA_ACCIONES (share-secured) ──
  'garantia de acciones': 'PRESTAMO_GARANTIA_ACCIONES',
  'prestamo con garantia de acciones': 'PRESTAMO_GARANTIA_ACCIONES',
  'prestamos con garantia de acciones': 'PRESTAMO_GARANTIA_ACCIONES',
  'share secured': 'PRESTAMO_GARANTIA_ACCIONES',
  'share secured loan': 'PRESTAMO_GARANTIA_ACCIONES',
  'share secured loans': 'PRESTAMO_GARANTIA_ACCIONES',
  pignoraticio: 'PRESTAMO_GARANTIA_ACCIONES',

  // ── CLUB_NAVIDAD ──
  'club de navidad': 'CLUB_NAVIDAD',
  'club navidad': 'CLUB_NAVIDAD',
  'christmas club': 'CLUB_NAVIDAD',
  'christmas club account': 'CLUB_NAVIDAD',
  'christmas club accounts': 'CLUB_NAVIDAD',

  // ── CUENTA_AHORRO (shares / acciones) ──
  acciones: 'CUENTA_AHORRO',
  'cuenta de ahorro': 'CUENTA_AHORRO',
  'cuenta de ahorros': 'CUENTA_AHORRO',
  'cuentas de ahorro': 'CUENTA_AHORRO',
  ahorro: 'CUENTA_AHORRO',
  ahorros: 'CUENTA_AHORRO',
  shares: 'CUENTA_AHORRO',
  'share savings': 'CUENTA_AHORRO',
  'share savings account': 'CUENTA_AHORRO',
  'share savings accounts': 'CUENTA_AHORRO',
  savings: 'CUENTA_AHORRO',

  // ── CERTIFICADO_DEPOSITO ──
  'certificado de deposito': 'CERTIFICADO_DEPOSITO',
  'certificados de deposito': 'CERTIFICADO_DEPOSITO',
  certificado: 'CERTIFICADO_DEPOSITO',
  cd: 'CERTIFICADO_DEPOSITO',
  'certificate of deposit': 'CERTIFICADO_DEPOSITO',
  'certificates of deposit': 'CERTIFICADO_DEPOSITO',
  'share certificate': 'CERTIFICADO_DEPOSITO',
  'time deposit': 'CERTIFICADO_DEPOSITO',
};

/**
 * ORDERED token rules, tried only after an exact-match miss.
 *
 * ORDER IS LOAD-BEARING. `garantia`+`acciones` must be tested before the bare
 * `acciones` rule, or every share-secured LOAN is misfiled as a share savings
 * DEPOSIT — wrong balance-sheet side, and PD silently becomes null. The spec
 * asserts this ordering directly so a future reshuffle fails loudly.
 *
 * Each rule requires ALL of its tokens to be present as whole words. Whole-word
 * matching (not `includes`) keeps "auto" from firing on "automatico".
 */
interface TokenRule {
  /** Whole-word tokens. ALL must be present for the rule to fire. */
  readonly tokens: readonly string[];
  /**
   * Prefix stems, matched against the START of any word. Opt-in per rule
   * because prefix matching is genuinely dangerous: a blanket prefix match
   * would let `auto` fire on "automatico" (an unrelated word that appears in
   * core-system descriptions) and misfile it as an auto loan. Only labels with
   * real inflectional families — hipoteca/hipotecario/hipotecaria — get one.
   */
  readonly stems?: readonly string[];
  readonly productType: CooperativaProductType;
}

const ORDERED_TOKEN_RULES: readonly TokenRule[] = [
  // Most specific first — see the ordering note above.
  {
    tokens: ['garantia', 'acciones'],
    productType: 'PRESTAMO_GARANTIA_ACCIONES',
  },
  { tokens: ['share', 'secured'], productType: 'PRESTAMO_GARANTIA_ACCIONES' },
  { tokens: ['club', 'navidad'], productType: 'CLUB_NAVIDAD' },
  { tokens: ['christmas', 'club'], productType: 'CLUB_NAVIDAD' },
  { tokens: [], stems: ['certificad'], productType: 'CERTIFICADO_DEPOSITO' },
  { tokens: [], stems: ['certificate'], productType: 'CERTIFICADO_DEPOSITO' },
  // hipoteca / hipotecario / hipotecaria — a real inflectional family.
  { tokens: [], stems: ['hipotec'], productType: 'HIPOTECA' },
  { tokens: ['mortgage'], productType: 'HIPOTECA' },
  { tokens: ['auto'], productType: 'PRESTAMO_AUTO' },
  { tokens: ['vehiculo'], productType: 'PRESTAMO_AUTO' },
  // comercial / comerciales
  { tokens: [], stems: ['comercial'], productType: 'PRESTAMO_COMERCIAL' },
  { tokens: [], stems: ['commercial'], productType: 'PRESTAMO_COMERCIAL' },
  { tokens: ['industrial'], productType: 'PRESTAMO_COMERCIAL' },
  { tokens: ['mbl'], productType: 'PRESTAMO_COMERCIAL' },
  { tokens: ['personal'], productType: 'PRESTAMO_PERSONAL' },
  { tokens: ['consumo'], productType: 'PRESTAMO_PERSONAL' },
  // Bare `acciones`/`ahorro` last: by here the share-secured rule has already
  // had its chance, so a surviving "acciones" really is the savings product.
  { tokens: ['acciones'], productType: 'CUENTA_AHORRO' },
  { tokens: ['ahorro'], productType: 'CUENTA_AHORRO' },
  { tokens: ['savings'], productType: 'CUENTA_AHORRO' },
];

/** How a label resolved — useful for provenance and for tests. */
export type ProductMatchMethod = 'canonical' | 'exact-synonym' | 'token-rule';

export interface ProductMatch {
  productType: CooperativaProductType;
  /** Which phase resolved it — recorded so provenance stays auditable. */
  method: ProductMatchMethod;
  /** The normalized form that matched, for debugging unmapped-label reports. */
  normalized: string;
}

const CANONICAL_SET: ReadonlySet<string> = new Set(COOPERATIVA_PRODUCT_TYPES);

/**
 * Maps a free-text product label to its canonical type.
 *
 * Returns `null` when the label is not recognized — the caller MUST disclose
 * that as a gap rather than substituting a default (D1).
 */
export function mapProductLabel(
  raw: string | null | undefined,
): ProductMatch | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Phase 0 — already canonical (idempotent re-mapping).
  const upper = trimmed.toUpperCase().replace(/[^A-Z_]/g, '_');
  if (CANONICAL_SET.has(upper)) {
    return {
      productType: upper as CooperativaProductType,
      method: 'canonical',
      normalized: normalizeProductLabel(trimmed),
    };
  }

  const normalized = normalizeProductLabel(trimmed);
  if (normalized.length === 0) return null;

  // Phase 1 — exact synonym.
  const exact = EXACT_SYNONYMS[normalized];
  if (exact !== undefined) {
    return { productType: exact, method: 'exact-synonym', normalized };
  }

  // Phase 2 — ordered token rules.
  const wordList = normalized.split(' ');
  const words = new Set(wordList);
  for (const rule of ORDERED_TOKEN_RULES) {
    const tokensPresent = rule.tokens.every((token) => words.has(token));
    const stemsPresent = (rule.stems ?? []).every((stem) =>
      wordList.some((w) => w.startsWith(stem)),
    );
    // A rule with neither tokens nor stems would match everything — guard so a
    // malformed future entry cannot silently swallow every unmapped label.
    const hasCriteria = rule.tokens.length > 0 || (rule.stems ?? []).length > 0;
    if (hasCriteria && tokensPresent && stemsPresent) {
      return {
        productType: rule.productType,
        method: 'token-rule',
        normalized,
      };
    }
  }

  return null;
}

/**
 * The asset-side lending products — the ones that can carry a loan lifecycle.
 * Deposits and shares never do.
 *
 * Derived from the registry's own `side === 'asset'` rather than re-listed by
 * hand: a second hand-maintained list is exactly the drift this module exists
 * to eliminate. Adding a lending product to the registry makes it lendable
 * here automatically.
 */
const LENDING_PRODUCTS: ReadonlySet<CooperativaProductType> = new Set(
  COOPERATIVA_PRODUCT_TYPES.filter(
    (t) => COOPERATIVA_PRODUCT_REGISTRY[t].side === 'asset',
  ),
);

/**
 * True when the product is an asset-side lending product — i.e. one that can
 * carry a loan lifecycle.
 */
export function isLendingProduct(productType: CooperativaProductType): boolean {
  return LENDING_PRODUCTS.has(productType);
}
