/**
 * Cooperativa Product Registry — the canonical taxonomy of Puerto Rico
 * cooperativa (COSSEC-regulated credit union) product types.
 *
 * This registry is the Layer 1 foundation for the cooperativa-native
 * compliance engine. Every product carries:
 *   - Spanish-FIRST labels (PR cooperativa terminology — socio, acciones,
 *     Club de Navidad), English second.
 *   - The balance-sheet subcategory it maps to (CSV ingestion taxonomy).
 *   - CECL eligibility (loans yes; shares/CDs/Club de Navidad are
 *     liability-side products and never enter the allowance).
 *   - Provisional PD/LGD defaults for the PD×LGD CECL methodology,
 *     with documented provenance.
 *
 * CALIBRATION PROVENANCE (provisional — see OPERATOR-INPUT-NEEDED below):
 * Default annual PDs and LGDs start from NCUA 5300 aggregate charge-off
 * rates for federally insured credit unions, adjusted for documented PR
 * conditions: post-María delinquency cycles (2017-2019 COSSEC annual
 * reports showed consumer delinquency peaking ~2x mainland), sustained
 * net out-migration (US Census PR estimates, -1%/yr trend), and collateral
 * recovery haircuts on PR real estate (longer foreclosure timelines under
 * PR civil law; FHFA PR HPI volatility).
 *
 * OPERATOR-INPUT-NEEDED: final PD/LGD calibration per product requires
 * either (a) the institution's own historical loss data (preferred — the
 * registry default is only a cold-start prior), or (b) a COSSEC/NCUA PR
 * pooled-loss dataset. When a registry default is used in a CECL
 * computation, the engine emits a WARNING DataGap so the report discloses
 * the provenance — defaults are configuration, never silently fabricated
 * institution data (D1).
 */

// ─── Product type taxonomy ───────────────────────────────────

export const COOPERATIVA_PRODUCT_TYPES = [
  'PRESTAMO_PERSONAL',
  'PRESTAMO_AUTO',
  'HIPOTECA',
  'PRESTAMO_COMERCIAL', // MBL — member business loan
  'PRESTAMO_GARANTIA_ACCIONES', // share-secured
  'CLUB_NAVIDAD',
  'CUENTA_AHORRO', // shares / acciones
  'CERTIFICADO_DEPOSITO',
] as const;

export type CooperativaProductType = (typeof COOPERATIVA_PRODUCT_TYPES)[number];

export type ProductSide = 'asset' | 'liability';

export interface CooperativaProductDefaults {
  productType: CooperativaProductType;
  /** Spanish-first display label (PR cooperativa terminology). */
  nombre: string;
  /** English label, second-class by design. */
  nameEn: string;
  /** Which side of the balance sheet the product lives on. */
  side: ProductSide;
  /** BalanceSheetItem subcategory this product maps to (CSV taxonomy). */
  balanceSheetSubcategory: string;
  /** Whether the product enters the CECL allowance (loans only). */
  ceclEligible: boolean;
  /**
   * Provisional annual probability of default (decimal). `null` for
   * liability-side products — PD is meaningless for deposits/shares.
   */
  defaultAnnualPd: number | null;
  /** Provisional loss given default (decimal). `null` for liabilities. */
  defaultLgd: number | null;
  /** Typical weighted average maturity in years (cold-start prior). */
  defaultMaturityYears: number;
  /** Short Spanish rationale displayed in tooltips / report footnotes. */
  notaCalibracion: string;
}

// ─── Registry ────────────────────────────────────────────────

export const COOPERATIVA_PRODUCT_REGISTRY: Record<
  CooperativaProductType,
  CooperativaProductDefaults
> = {
  PRESTAMO_PERSONAL: {
    productType: 'PRESTAMO_PERSONAL',
    nombre: 'Préstamos personales',
    nameEn: 'Personal loans',
    side: 'asset',
    balanceSheetSubcategory: 'consumer_loans',
    ceclEligible: true,
    defaultAnnualPd: 0.025,
    defaultLgd: 0.65,
    defaultMaturityYears: 3.5,
    notaCalibracion:
      'Consumo no garantizado: PD ajustada al alza vs. promedio NCUA por ciclos de morosidad post-María; LGD alta por falta de colateral.',
  },
  PRESTAMO_AUTO: {
    productType: 'PRESTAMO_AUTO',
    nombre: 'Préstamos de auto',
    nameEn: 'Auto loans',
    side: 'asset',
    balanceSheetSubcategory: 'consumer_loans',
    ceclEligible: true,
    defaultAnnualPd: 0.014,
    defaultLgd: 0.45,
    defaultMaturityYears: 4.5,
    notaCalibracion:
      'Colateral vehicular con mercado secundario activo en PR; LGD moderada por depreciación y costos de reposesión.',
  },
  HIPOTECA: {
    productType: 'HIPOTECA',
    nombre: 'Hipotecas',
    nameEn: 'Residential mortgages',
    side: 'asset',
    balanceSheetSubcategory: 'residential_mortgages',
    ceclEligible: true,
    defaultAnnualPd: 0.009,
    defaultLgd: 0.35,
    defaultMaturityYears: 18,
    notaCalibracion:
      'LGD por encima del promedio continental: plazos de ejecución hipotecaria más largos bajo derecho civil de PR y volatilidad del índice FHFA-PR.',
  },
  PRESTAMO_COMERCIAL: {
    productType: 'PRESTAMO_COMERCIAL',
    nombre: 'Préstamos comerciales (MBL)',
    nameEn: 'Member business loans (MBL)',
    side: 'asset',
    balanceSheetSubcategory: 'commercial_loans',
    ceclEligible: true,
    defaultAnnualPd: 0.018,
    defaultLgd: 0.45,
    defaultMaturityYears: 6,
    notaCalibracion:
      'PYMES locales sensibles a turismo y migración poblacional; concentración geográfica por municipio amplifica el riesgo.',
  },
  PRESTAMO_GARANTIA_ACCIONES: {
    productType: 'PRESTAMO_GARANTIA_ACCIONES',
    nombre: 'Préstamos con garantía de acciones',
    nameEn: 'Share-secured loans',
    side: 'asset',
    balanceSheetSubcategory: 'consumer_loans',
    ceclEligible: true,
    defaultAnnualPd: 0.003,
    defaultLgd: 0.05,
    defaultMaturityYears: 2,
    notaCalibracion:
      'Garantizado por las propias acciones del socio en la cooperativa; pérdida esperada casi nula por compensación directa.',
  },
  CLUB_NAVIDAD: {
    productType: 'CLUB_NAVIDAD',
    nombre: 'Club de Navidad',
    nameEn: 'Christmas club accounts',
    side: 'liability',
    balanceSheetSubcategory: 'savings_deposits',
    ceclEligible: false,
    defaultAnnualPd: null,
    defaultLgd: null,
    defaultMaturityYears: 1,
    notaCalibracion:
      'Depósito estacional con desembolso concentrado en noviembre-diciembre; relevante para liquidez (LCR), no para CECL.',
  },
  CUENTA_AHORRO: {
    productType: 'CUENTA_AHORRO',
    nombre: 'Cuentas de ahorro (acciones)',
    nameEn: 'Share savings accounts',
    side: 'liability',
    balanceSheetSubcategory: 'savings_deposits',
    ceclEligible: false,
    defaultAnnualPd: null,
    defaultLgd: null,
    defaultMaturityYears: 0,
    notaCalibracion:
      'Acciones del socio — base de capital social de la cooperativa; estabilidad alta, beta de depósito baja.',
  },
  CERTIFICADO_DEPOSITO: {
    productType: 'CERTIFICADO_DEPOSITO',
    nombre: 'Certificados de depósito',
    nameEn: 'Certificates of deposit',
    side: 'liability',
    balanceSheetSubcategory: 'time_deposits',
    ceclEligible: false,
    defaultAnnualPd: null,
    defaultLgd: null,
    defaultMaturityYears: 1.5,
    notaCalibracion:
      'Depósito a plazo con vencimiento contractual; sensible a competencia de tasas de bancos comerciales.',
  },
};

// ─── PR macro scenario overlay ───────────────────────────────

/**
 * PR-specific CECL macro overlay. Mainland CCAR multipliers (1.0/1.8/3.0)
 * and FASB community weights (50/30/20) understate PR tail risk: hurricane
 * landfall probability, sustained out-migration, and federal transfer
 * cliffs (Medicaid) produce fatter loss tails than the mainland cycle.
 *
 * Provisional calibration (OPERATOR-INPUT-NEEDED for final values):
 * - adverse 2.1x ≈ mainland adverse (1.8x) scaled by the post-María
 *   consumer delinquency peak ratio observed in COSSEC annual data.
 * - severely_adverse 3.6x ≈ mainland severe (3.0x) scaled by the same
 *   factor, representing a Cat-4+ landfall + migration-shock year.
 * - Weights shift mass from baseline to adverse (45/35/20) because PR has
 *   spent a larger share of the last two decades in contractionary
 *   conditions than the mainland (BLS PR unemployment vs. US average).
 */
export const PR_SCENARIO_WEIGHTS = {
  baseline: 0.45,
  adverse: 0.35,
  severely_adverse: 0.2,
} as const;

export const PR_PD_MULTIPLIERS = {
  baseline: 1.0,
  adverse: 2.1,
  severely_adverse: 3.6,
} as const;

// ─── Segment-name → product-type matching ────────────────────

/**
 * Match free-form segment names (Spanish or English, as they arrive from
 * CSV uploads or core exports) to a registry product type. Conservative:
 * returns null when no confident match exists — callers must surface a
 * WARNING gap rather than guess (D1).
 */
const MATCHERS: Array<{ type: CooperativaProductType; pattern: RegExp }> = [
  // Order matters: more specific patterns first.
  {
    type: 'PRESTAMO_GARANTIA_ACCIONES',
    pattern:
      /(garant[ií]a de acciones|share[\s-]?secured|garantizad[oa]s? (con|por|mediante) acciones|colateral(izad[oa]s?)? (de|con) acciones|respaldad[oa]s? (con|por) acciones|pignoraci[óo]n de acciones|sobre acciones)/i,
  },
  {
    type: 'CLUB_NAVIDAD',
    pattern: /(club de navidad|christmas club|navidad)/i,
  },
  {
    type: 'CERTIFICADO_DEPOSITO',
    pattern:
      /(certificado|certificate of deposit|\bcds?\b|time deposit|dep[óo]sito a plazo)/i,
  },
  {
    type: 'CUENTA_AHORRO',
    pattern: /(ahorro|acciones|share savings|shares?\b|savings)/i,
  },
  {
    type: 'HIPOTECA',
    pattern: /(hipotec|mortgage|residencial|residential)/i,
  },
  {
    type: 'PRESTAMO_AUTO',
    pattern: /(auto|vehicul|vehicle|car loan)/i,
  },
  {
    type: 'PRESTAMO_COMERCIAL',
    pattern: /(comercial|commercial|business|mbl|pyme)/i,
  },
  {
    type: 'PRESTAMO_PERSONAL',
    pattern: /(personal|consumo|consumer|unsecured)/i,
  },
];

/**
 * Loan-side tokens. A segment naming BOTH a loan and shares ("acciones"/
 * "shares") is a share-secured LOAN (asset), never a share-savings account
 * (liability) — e.g. "Préstamo garantizado con acciones", "colateral de
 * acciones". Without this disambiguation the broad CUENTA_AHORRO "acciones"
 * token would capture such names and the loan would be silently dropped from
 * the CECL allowance and misclassified on the COSSEC filing (a D1 violation).
 */
const LOAN_TOKEN = /(pr[ée]stamo|loan|cr[ée]dito|financ)/i;

export function matchProductType(
  segmentName: string,
): CooperativaProductType | null {
  if (!segmentName) return null;
  // Disambiguation guard (see LOAN_TOKEN): loan + shares ⇒ share-secured loan.
  if (LOAN_TOKEN.test(segmentName) && /(acci[óo]n|share)/i.test(segmentName)) {
    return 'PRESTAMO_GARANTIA_ACCIONES';
  }
  for (const { type, pattern } of MATCHERS) {
    if (pattern.test(segmentName)) return type;
  }
  return null;
}

/** All CECL-eligible (asset-side loan) products, in registry order. */
export function ceclEligibleProducts(): CooperativaProductDefaults[] {
  return COOPERATIVA_PRODUCT_TYPES.map(
    (t) => COOPERATIVA_PRODUCT_REGISTRY[t],
  ).filter((p) => p.ceclEligible);
}
