/**
 * Dynamic builder for the Mauldin SIC 2026 demo institution
 * ("Cooperativa San Juan Federal").
 *
 * This intentionally REPLACES the static `pr-cooperativa-san-juan-federal.json`
 * fixture. Nothing about the demo balance sheet is a frozen literal: every
 * derived figure — cash, equity, borrowings, the LCR, the capital ratio, and the
 * CECL loan segments — is COMPUTED from a small set of parameters and enforced by
 * balance-sheet invariants. Change `capitalRatioPct` and the equity + borrowings
 * plug recompute; change a loan amount and cash, the segments, and the downstream
 * stress credit-loss all move with it.
 *
 * The defaults reproduce the demo brief ($250M, 10% capital, $175M loans, $210M
 * deposits) — but they are INPUTS, not a hand-typed snapshot.
 */
import type {
  InstitutionFixture,
  InstitutionFixtureItem,
  InstitutionFixtureLoanSegment,
} from '../_schema';

export interface DemoLoanBook {
  /** Auto + personal consumer loans, $M. */
  consumer: number;
  /** Residential mortgages, $M. */
  residential: number;
  /** Commercial / member-business loans, $M. */
  commercial: number;
}

export interface DemoInvestments {
  /** US Treasuries, $M (HQLA Level 1). */
  treasuries: number;
  /** Agency MBS, $M (HQLA Level 2). */
  agencyMbs: number;
}

export interface DemoDeposits {
  savings: number;
  shareCertificates: number;
  demand: number;
  timeDeposits: number;
}

export interface SanJuanFederalParams {
  seedKey: string;
  name: string;
  reportingDate: string;
  cossecRegistrationNumber: string;
  /** Total assets, $M. The asset side is built to sum to exactly this. */
  totalAssets: number;
  /** Capital ratio (equity / total assets), as a percent. Drives equity. */
  capitalRatioPct: number;
  loans: DemoLoanBook;
  investments: DemoInvestments;
  deposits: DemoDeposits;
  liquidity: {
    hqlaLevel1: number;
    hqlaLevel2: number;
    cashOutflows: number;
    nsfr: number;
  };
}

/**
 * Default parameter set — encodes the SIC 2026 demo brief as INPUTS.
 * Derived results (cash, equity, borrowings, lcr) are intentionally NOT here;
 * the builder computes them.
 */
export const SAN_JUAN_FEDERAL_DEFAULTS: SanJuanFederalParams = {
  seedKey: 'pr-cooperativa-san-juan-federal',
  name: 'Cooperativa San Juan Federal',
  reportingDate: '2026-03-31',
  cossecRegistrationNumber: 'COSSEC-2024-0847',
  totalAssets: 250,
  capitalRatioPct: 10,
  loans: { consumer: 80, residential: 60, commercial: 35 },
  investments: { treasuries: 30, agencyMbs: 20 },
  deposits: {
    savings: 95,
    shareCertificates: 70,
    demand: 30,
    timeDeposits: 15,
  },
  liquidity: { hqlaLevel1: 40, hqlaLevel2: 15, cashOutflows: 45, nsfr: 110 },
};

/**
 * Rate / duration assumptions per balance-sheet line. These are model INPUTS
 * (assumptions about the book), not computed results — overridable only by
 * editing the builder. Rates are percents; durations are Macaulay years.
 */
const RATE_CARD = {
  consumer_loans: { rate: 8.75, duration: 3.0, rateType: 'fixed' as const },
  residential_mortgages: {
    rate: 6.25,
    duration: 12.0,
    rateType: 'fixed' as const,
  },
  commercial_loans: { rate: 9.0, duration: 2.5, rateType: 'variable' as const },
  treasuries: { rate: 4.25, duration: 4.0, rateType: 'fixed' as const },
  agency_mbs: { rate: 5.0, duration: 5.5, rateType: 'fixed' as const },
  cash_equivalents: {
    rate: 5.25,
    duration: 0.1,
    rateType: 'variable' as const,
  },
  savings_deposits: {
    rate: 1.75,
    duration: 0.3,
    rateType: 'variable' as const,
    depositBeta: 0.35,
  },
  share_certificates: {
    rate: 4.5,
    duration: 1.2,
    rateType: 'fixed' as const,
  },
  demand_deposits: {
    rate: 0.25,
    duration: 0.1,
    rateType: 'variable' as const,
    depositBeta: 0.15,
  },
  time_deposits: { rate: 4.0, duration: 0.8, rateType: 'fixed' as const },
  borrowings: { rate: 5.5, duration: 2.0, rateType: 'fixed' as const },
};

/** CECL loss assumptions per loan segment (inputs). */
const SEGMENT_CARD = {
  consumer: {
    segmentName: 'Préstamos de Consumo (Auto y Personal)',
    weightedAvgRate: 0.0825,
    weightedAvgMaturity: 3.8,
    historicalLossRate: 0.02,
    lgd: 0.55,
    qualitativeAdj: 0.002,
  },
  residential: {
    segmentName: 'Hipotecas Residenciales',
    weightedAvgRate: 0.0625,
    weightedAvgMaturity: 18,
    historicalLossRate: 0.008,
    lgd: 0.35,
    qualitativeAdj: 0,
  },
  commercial: {
    segmentName: 'Préstamos Comerciales (MBL)',
    weightedAvgRate: 0.09,
    weightedAvgMaturity: 6,
    historicalLossRate: 0.016,
    lgd: 0.45,
    qualitativeAdj: 0.003,
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mergeParams(
  overrides: Partial<SanJuanFederalParams>,
): SanJuanFederalParams {
  const d = SAN_JUAN_FEDERAL_DEFAULTS;
  return {
    ...d,
    ...overrides,
    loans: { ...d.loans, ...(overrides.loans ?? {}) },
    investments: { ...d.investments, ...(overrides.investments ?? {}) },
    deposits: { ...d.deposits, ...(overrides.deposits ?? {}) },
    liquidity: { ...d.liquidity, ...(overrides.liquidity ?? {}) },
  };
}

/**
 * Build the demo institution from parameters. Deterministic: same params ⇒ same
 * fixture (no RNG, SR 11-7 friendly). Throws when the parameters imply an
 * impossible balance sheet (negative derived cash or borrowings) rather than
 * silently producing a nonsensical institution.
 */
export function buildSanJuanFederalDemo(
  overrides: Partial<SanJuanFederalParams> = {},
): InstitutionFixture {
  const p = mergeParams(overrides);

  const totalLoans =
    p.loans.consumer + p.loans.residential + p.loans.commercial;
  const totalInvestments = p.investments.treasuries + p.investments.agencyMbs;
  const totalDeposits =
    p.deposits.savings +
    p.deposits.shareCertificates +
    p.deposits.demand +
    p.deposits.timeDeposits;

  // ── Derived (never hard-coded) ──
  const cash = round2(p.totalAssets - totalLoans - totalInvestments); // asset-side plug
  const equity = round2(p.totalAssets * (p.capitalRatioPct / 100));
  const totalLiabilities = round2(p.totalAssets - equity);
  const borrowings = round2(totalLiabilities - totalDeposits); // liability-side plug

  // ── Invariants: refuse to emit an impossible balance sheet ──
  if (cash < 0) {
    throw new Error(
      `buildSanJuanFederalDemo: derived cash is negative (${cash}) — loans (${totalLoans}) + investments (${totalInvestments}) exceed total assets (${p.totalAssets}).`,
    );
  }
  if (borrowings < 0) {
    throw new Error(
      `buildSanJuanFederalDemo: derived borrowings is negative (${borrowings}) — deposits (${totalDeposits}) exceed liabilities (${totalLiabilities}); raise totalAssets, lower deposits, or lower capitalRatioPct.`,
    );
  }

  const items: InstitutionFixtureItem[] = [
    {
      category: 'asset',
      subcategory: 'consumer_loans',
      name: 'Préstamos de Auto y Personal',
      balance: p.loans.consumer,
      ...RATE_CARD.consumer_loans,
    },
    {
      category: 'asset',
      subcategory: 'residential_mortgages',
      name: 'Préstamos Hipotecarios',
      balance: p.loans.residential,
      ...RATE_CARD.residential_mortgages,
    },
    {
      category: 'asset',
      subcategory: 'commercial_loans',
      name: 'Préstamos Comerciales',
      balance: p.loans.commercial,
      ...RATE_CARD.commercial_loans,
    },
    {
      category: 'asset',
      subcategory: 'investment_securities',
      name: 'Bonos del Tesoro de EE.UU.',
      balance: p.investments.treasuries,
      ...RATE_CARD.treasuries,
    },
    {
      category: 'asset',
      subcategory: 'investment_securities',
      name: 'Valores Hipotecarios de Agencia (MBS)',
      balance: p.investments.agencyMbs,
      ...RATE_CARD.agency_mbs,
    },
    {
      category: 'asset',
      subcategory: 'cash_equivalents',
      name: 'Efectivo y Equivalentes',
      balance: cash,
      ...RATE_CARD.cash_equivalents,
    },
    {
      category: 'liability',
      subcategory: 'savings_deposits',
      name: 'Ahorros de Socios',
      balance: p.deposits.savings,
      ...RATE_CARD.savings_deposits,
    },
    {
      category: 'liability',
      subcategory: 'time_deposits',
      name: 'Certificados de Acción',
      balance: p.deposits.shareCertificates,
      ...RATE_CARD.share_certificates,
    },
    {
      category: 'liability',
      subcategory: 'demand_deposits',
      name: 'Cuentas Corrientes',
      balance: p.deposits.demand,
      ...RATE_CARD.demand_deposits,
    },
    {
      category: 'liability',
      subcategory: 'time_deposits',
      name: 'Depósitos a Plazo',
      balance: p.deposits.timeDeposits,
      ...RATE_CARD.time_deposits,
    },
    {
      category: 'liability',
      subcategory: 'borrowings',
      name: 'Préstamos FHLB',
      balance: borrowings,
      ...RATE_CARD.borrowings,
    },
  ];

  const lcr =
    p.liquidity.cashOutflows > 0
      ? round2(
          ((p.liquidity.hqlaLevel1 + p.liquidity.hqlaLevel2) /
            p.liquidity.cashOutflows) *
            100,
        )
      : 0;

  const loanSegments: InstitutionFixtureLoanSegment[] = [
    { ...SEGMENT_CARD.consumer, balance: p.loans.consumer },
    { ...SEGMENT_CARD.residential, balance: p.loans.residential },
    { ...SEGMENT_CARD.commercial, balance: p.loans.commercial },
  ];

  return {
    seedKey: p.seedKey,
    name: p.name,
    type: 'cooperativa',
    totalAssets: p.totalAssets,
    currency: 'USD',
    reportingDate: p.reportingDate,
    primaryRegulator: 'COSSEC',
    cossecRegistrationNumber: p.cossecRegistrationNumber,
    fiscalYearEnd: 'december',
    preferredLanguage: 'es',
    items,
    liquidity: {
      date: p.reportingDate,
      hqlaLevel1: p.liquidity.hqlaLevel1,
      hqlaLevel2: p.liquidity.hqlaLevel2,
      cashOutflows: p.liquidity.cashOutflows,
      cashInflows: 0,
      lcr,
      nsfr: p.liquidity.nsfr,
    },
    loanSegments,
  };
}
