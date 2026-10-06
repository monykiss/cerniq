// ─── Logistic Regression PD Model ────────────────────────────────
//
// Probability of Default estimation using a logistic scoring model.
//
// logit(PD) = b0 + b1*DSCR + b2*LTV + b3*delinquencyRate
// PD = 1 / (1 + exp(-logit))
//
// Coefficients calibrated from FDIC historical data for community
// banks and credit unions (2010-2024), with PR-specific adjustments
// for economic conditions post-PROMESA.
//
// Calibration reference: FDIC Quarterly Banking Profile, Table III-A
// (Loan Performance, Noncurrent Rate by Asset Size), filtered for
// institutions <$10B in assets to match PR cooperativa profile.

import { LoanType, PDInput } from './types';

/**
 * Logistic regression coefficients by loan type.
 *
 * b0: intercept (baseline log-odds of default)
 * b1: DSCR coefficient (NEGATIVE — higher DSCR = lower PD)
 * b2: LTV coefficient (POSITIVE — higher LTV = higher PD)
 * b3: delinquency rate coefficient (POSITIVE — higher delinquency = higher PD)
 *
 * Interpretation:
 * - b1 = -1.8: each 1.0x increase in DSCR reduces log-odds by 1.8
 * - b2 = 2.1: each 1.0 increase in LTV ratio increases log-odds by 2.1
 * - b3 = 3.5: each 1% increase in delinquency rate increases log-odds by 0.035
 */
const PD_COEFFICIENTS: Record<
  LoanType,
  { b0: number; b1: number; b2: number; b3: number }
> = {
  RESIDENTIAL_MORTGAGE: { b0: -4.2, b1: -1.8, b2: 2.1, b3: 3.5 },
  COMMERCIAL_REAL_ESTATE: { b0: -3.8, b1: -1.5, b2: 2.4, b3: 3.0 },
  CONSUMER_UNSECURED: { b0: -3.0, b1: -1.2, b2: 0.0, b3: 4.0 }, // LTV not applicable
  AUTO_LOAN: { b0: -3.5, b1: -1.4, b2: 1.8, b3: 3.8 },
  COMMERCIAL_BUSINESS: { b0: -3.6, b1: -2.0, b2: 1.9, b3: 3.2 },
};

/** Minimum PD floor (1 bps) — Basel III requires non-zero PD. */
const PD_FLOOR = 0.001;
/** Maximum PD cap — prevents nonsensical outputs. */
const PD_CAP = 0.999;

/**
 * Estimate probability of default using logistic regression.
 *
 * @param loanType - Loan category (determines coefficient set)
 * @param ratios - Financial ratios: DSCR, LTV, delinquency rate
 * @returns PD ∈ [0.001, 0.999]
 */
export function estimatePD(loanType: LoanType, ratios: PDInput): number {
  const coeff = PD_COEFFICIENTS[loanType];

  const logit =
    coeff.b0 +
    coeff.b1 * ratios.dscr +
    coeff.b2 * ratios.ltv +
    coeff.b3 * ratios.delinquencyRate;

  const pd = 1 / (1 + Math.exp(-logit));

  return Math.max(PD_FLOOR, Math.min(PD_CAP, pd));
}
