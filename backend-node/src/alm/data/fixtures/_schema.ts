/**
 * Institution fixture format for the idempotent seed pipeline.
 *
 * Every fixture is a deterministic, reviewable snapshot of an institution as it should
 * appear after seeding. The seed pipeline upserts by `(workspaceId, seedKey)`, replaces
 * the balance sheet items inside a transaction, and upserts the liquidity position by
 * `(institutionId, date)`. Re-running the seed against the same fixture is a no-op.
 *
 * Fixtures live as plain JSON next to this file so they can be reviewed in PRs without
 * reading TypeScript and shared with non-engineers (analysts, regulators, sales).
 */

export interface InstitutionFixture {
  /**
   * Stable identifier for this fixture. Becomes `Institution.seedKey`. Must be unique
   * within a workspace. Convention: kebab-case, prefixed by region. e.g. `pr-coop-demo`.
   */
  seedKey: string;

  /**
   * The institution's display name. Bilingual fixtures may include both languages in
   * the name; the `preferredLanguage` field controls the UI default.
   */
  name: string;

  /** bank | credit_union | family_office | cooperativa */
  type: 'bank' | 'credit_union' | 'family_office' | 'cooperativa';

  /** Total assets in millions, in the institution's reporting currency. */
  totalAssets: number;

  /** ISO 4217 currency code. All balance sheet items must be in this currency. */
  currency: string;

  /** ISO 8601 date for the snapshot. */
  reportingDate: string;

  primaryRegulator?: string;
  cossecRegistrationNumber?: string;
  fiscalYearEnd?: 'december' | 'june' | 'march';
  preferredLanguage?: 'es' | 'en' | 'both';

  /** Balance sheet items. The seeder replaces all items on every run inside a transaction. */
  items: InstitutionFixtureItem[];

  /**
   * Liquidity position snapshot. Upserted by `(institutionId, date)`. The date defaults
   * to `reportingDate` if omitted.
   */
  liquidity: InstitutionFixtureLiquidity;

  /**
   * Optional loan segments for cooperativa CECL (PD×LGD). Consumed by
   * `getCooperativaCECLAnalysis` (and the golden-reconciliation snapshot) — the
   * seed pipeline does NOT seed these (it only replaces `items` + `liquidity`),
   * so they are inert for non-CECL fixtures.
   */
  loanSegments?: InstitutionFixtureLoanSegment[];
}

export interface InstitutionFixtureLoanSegment {
  /** Display name — must match a registry matcher (see `matchProductType`). */
  segmentName: string;
  /** Outstanding balance in millions, in the institution's reporting currency. */
  balance: number;
  /** Weighted average coupon as a decimal (0.065 = 6.5%). */
  weightedAvgRate: number;
  /** Weighted average remaining maturity in years. */
  weightedAvgMaturity: number;
  /** Annualized historical loss rate as a decimal (0.012 = 1.2%); 0 ⇒ use registry default. */
  historicalLossRate: number;
  /** Loss given default (0.0–1.0). */
  lgd: number;
  /** +/- qualitative adjustment to the loss rate (decimal). */
  qualitativeAdj: number;
}

export interface InstitutionFixtureItem {
  category: 'asset' | 'liability';
  subcategory: string;
  name: string;
  /** Balance in millions, in the institution's reporting currency. */
  balance: number;
  /** Yield/cost as a percent (e.g. 6.5 = 6.5%). The seeder normalizes this. */
  rate: number;
  /** Macaulay duration in years. */
  duration: number;
  rateType: 'fixed' | 'variable' | 'hybrid';
  /** Optional pass-through rate (0.0–1.0) for deposit beta calibration. */
  depositBeta?: number;
}

export interface InstitutionFixtureLiquidity {
  /** Snapshot date. Defaults to `reportingDate` if omitted. */
  date?: string;
  /** Cash + sovereign HQLA, in millions. */
  hqlaLevel1: number;
  /** Agency MBS + investment-grade corporates, in millions. */
  hqlaLevel2: number;
  cashOutflows: number;
  cashInflows: number;
  /** Liquidity Coverage Ratio as a percent (e.g. 117.9). */
  lcr: number;
  /** Net Stable Funding Ratio as a percent. */
  nsfr: number;
}

/**
 * Result of running the seed pipeline against a fixture. The delta is exposed so callers
 * (CLI, frontend, action registry) can render an honest "what changed" summary instead
 * of pretending every re-seed is a fresh creation.
 */
export interface SeedResult {
  institutionId: string;
  seedKey: string;
  delta: {
    institution: 'created' | 'updated' | 'unchanged';
    balanceSheetItems: { before: number; after: number; replaced: boolean };
    liquidityPosition: 'created' | 'updated' | 'unchanged';
  };
  fixture: {
    seedKey: string;
    name: string;
    itemCount: number;
  };
}
