// ─── Portfolio Credit Risk Engine — EL/UL/Economic Capital ──────
//
// Vasicek single-factor model for portfolio-level credit risk:
//   UL = N(N_inv(PD)/sqrt(1-rho) + sqrt(rho/(1-rho)) * N_inv(0.999)) * LGD * EAD - EL
//
// N() = standard normal CDF (Hart 1968 rational polynomial approximation)
// N_inv() = standard normal inverse CDF (Beasley-Springer-Moro algorithm)
//
// Economic Capital = sum of UL across all loan categories.
// This is the amount of capital a cooperativa should hold above expected
// losses to survive a 99.9% confidence stress event.

import {
  LoanType,
  LoanPortfolioInput,
  CategoryRisk,
  CreditRiskPortfolioResult,
} from './types';
import { computeEffectiveLGD, PR_ASSET_CORRELATION } from './lgd-table';
import { estimatePD } from './pd-model';

/**
 * Compute full portfolio credit risk analysis.
 *
 * For each loan category:
 * 1. PD = estimatePD(loanType, ratios)
 * 2. LGD = PR-specific effective LGD
 * 3. EAD = outstanding balance
 * 4. EL = PD * LGD * EAD
 * 5. UL = Vasicek formula at 99.9% confidence
 * 6. Economic Capital = total UL
 */
export function computeCreditRisk(
  portfolio: LoanPortfolioInput,
): CreditRiskPortfolioResult {
  if (portfolio.categories.length === 0) {
    return dataUnavailableResult();
  }

  const results: CategoryRisk[] = [];
  let totalEAD = 0;
  let totalEL = 0;
  let totalUL = 0;

  for (const cat of portfolio.categories) {
    const pd = estimatePD(cat.loanType, cat.financialRatios);
    const lgd = computeEffectiveLGD(cat.loanType);
    const ead = cat.outstandingBalance;
    const rho = PR_ASSET_CORRELATION[cat.loanType];

    const el = pd * lgd * ead;

    // Vasicek UL at 99.9% confidence
    const ul = computeVasicekUL(pd, lgd, ead, rho, 0.999) - el;

    results.push({
      loanType: cat.loanType,
      pd,
      lgd,
      ead,
      expectedLoss: el,
      unexpectedLoss: Math.max(0, ul), // floor at 0
      assetCorrelation: rho,
    });

    totalEAD += ead;
    totalEL += el;
    totalUL += Math.max(0, ul);
  }

  const economicCapital = totalUL;
  const coverageRatio =
    totalEL > 0 ? portfolio.loanLossReserve / totalEL : null;
  const elAsPercent = totalEAD > 0 ? (totalEL / totalEAD) * 100 : 0;

  // Capital adequacy assessment
  let capitalAdequacy: CreditRiskPortfolioResult['capitalAdequacy'];
  if (coverageRatio === null) {
    capitalAdequacy = 'data_unavailable';
  } else if (coverageRatio >= 1.2) {
    capitalAdequacy = 'adequate';
  } else if (coverageRatio >= 0.8) {
    capitalAdequacy = 'marginal';
  } else {
    capitalAdequacy = 'insufficient';
  }

  return {
    byCategory: results,
    totalEAD,
    totalEL,
    totalUL,
    economicCapital,
    coverageRatio,
    elAsPercent,
    capitalAdequacy,
    interpretation: buildInterpretation(results, coverageRatio, 'en'),
    interpretationEs: buildInterpretation(results, coverageRatio, 'es'),
  };
}

/**
 * Vasicek single-factor loss quantile.
 *
 * Returns the total loss at the given confidence level:
 *   Q(alpha) = N(N_inv(PD)/sqrt(1-rho) + sqrt(rho/(1-rho)) * N_inv(alpha)) * LGD * EAD
 */
function computeVasicekUL(
  pd: number,
  lgd: number,
  ead: number,
  rho: number,
  confidence: number,
): number {
  if (rho <= 0 || rho >= 1) {
    // Degenerate: no systematic risk, UL ≈ 0
    return pd * lgd * ead;
  }

  const nInvPD = normalInverse(pd);
  const nInvConf = normalInverse(confidence);

  const arg =
    nInvPD / Math.sqrt(1 - rho) + Math.sqrt(rho / (1 - rho)) * nInvConf;
  const conditionalPD = normalCDF(arg);

  return conditionalPD * lgd * ead;
}

// ─── Standard Normal CDF — Abramowitz & Stegun 26.2.17 ──────────
//
// Uses the complementary error function approach.
// Accurate to ~7.5 x 10^-8 across the full domain.
// No external statistics library required.

export function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * a);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = d * Math.exp(-0.5 * x * x) * poly;

  return x >= 0 ? 1 - tail : tail;
}

// ─── Standard Normal Inverse CDF — Beasley-Springer-Moro ────────
//
// Accurate to ~8 decimal places for p ∈ (0.0001, 0.9999).

export function normalInverse(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (Math.abs(p - 0.5) < 1e-15) return 0;

  // Rational approximation for the central region
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    // Rational approximation for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    // Rational approximation for central region
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    // Rational approximation for upper region
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

// ─── Interpretation Builder ──────────────────────────────────────

function buildInterpretation(
  categories: CategoryRisk[],
  coverageRatio: number | null,
  lang: 'en' | 'es',
): string {
  const highest = categories.reduce((a, b) =>
    a.expectedLoss > b.expectedLoss ? a : b,
  );

  if (lang === 'es') {
    const coverage =
      coverageRatio !== null
        ? `La reserva cubre ${(coverageRatio * 100).toFixed(0)}% de la perdida esperada.`
        : 'No hay datos de reserva disponibles.';
    return (
      `La categoria de mayor riesgo es ${loanTypeEs(highest.loanType)} ` +
      `con PD=${(highest.pd * 100).toFixed(2)}% y LGD=${(highest.lgd * 100).toFixed(0)}%. ` +
      coverage
    );
  }

  const coverage =
    coverageRatio !== null
      ? `Reserve covers ${(coverageRatio * 100).toFixed(0)}% of expected loss.`
      : 'No reserve data available.';
  return (
    `Highest risk category: ${highest.loanType} ` +
    `with PD=${(highest.pd * 100).toFixed(2)}% and LGD=${(highest.lgd * 100).toFixed(0)}%. ` +
    coverage
  );
}

function loanTypeEs(type: LoanType): string {
  const map: Record<LoanType, string> = {
    RESIDENTIAL_MORTGAGE: 'hipoteca residencial',
    COMMERCIAL_REAL_ESTATE: 'bienes raices comerciales',
    CONSUMER_UNSECURED: 'consumo sin garantia',
    AUTO_LOAN: 'prestamo auto',
    COMMERCIAL_BUSINESS: 'comercial empresarial',
  };
  return map[type];
}

function dataUnavailableResult(): CreditRiskPortfolioResult {
  return {
    byCategory: [],
    totalEAD: 0,
    totalEL: 0,
    totalUL: 0,
    economicCapital: 0,
    coverageRatio: null,
    elAsPercent: 0,
    capitalAdequacy: 'data_unavailable',
    interpretation:
      'No loan portfolio data available for credit risk analysis.',
    interpretationEs:
      'No hay datos de cartera de préstamos para análisis de riesgo crediticio.',
  };
}
