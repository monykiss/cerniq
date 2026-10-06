// ─── PR Credit Risk Types ────────────────────────────────────────
//
// Puerto Rico cooperativa credit risk differs from mainland:
// - CRIM property registry → collateral values differ from market
// - Hurricane Maria (2017) → 15-30% collateral haircut on certain property types
// - Act 60 tax exemptions → affect commercial loan performance
// - PROMESA legacy → municipal bond exposure unique to PR

export type LoanType =
  | 'RESIDENTIAL_MORTGAGE'
  | 'COMMERCIAL_REAL_ESTATE'
  | 'CONSUMER_UNSECURED'
  | 'AUTO_LOAN'
  | 'COMMERCIAL_BUSINESS';

export interface LGDConfig {
  baseLGD: number; // base loss given default (0–1)
  hurricaneAdjustment: number; // negative = increases LGD (more loss)
  crimDiscount: number; // CRIM assessed vs market value discount
  description: string;
  descriptionEs: string;
}

export interface PDInput {
  dscr: number; // debt service coverage ratio
  ltv: number; // loan-to-value ratio (0–1)
  delinquencyRate: number; // 30+ day delinquency rate (0–1)
}

export interface CategoryRisk {
  loanType: LoanType;
  pd: number;
  lgd: number;
  ead: number; // exposure at default ($M)
  expectedLoss: number;
  unexpectedLoss: number;
  assetCorrelation: number;
}

export interface CreditRiskPortfolioResult {
  byCategory: CategoryRisk[];
  totalEAD: number;
  totalEL: number;
  totalUL: number;
  economicCapital: number;
  coverageRatio: number | null; // loanLossReserve / totalEL
  elAsPercent: number; // EL as % of total portfolio
  capitalAdequacy:
    | 'adequate'
    | 'marginal'
    | 'insufficient'
    | 'data_unavailable';
  interpretation: string;
  interpretationEs: string;
}

export interface LoanPortfolioInput {
  categories: Array<{
    loanType: LoanType;
    outstandingBalance: number;
    financialRatios: PDInput;
  }>;
  loanLossReserve: number;
}
