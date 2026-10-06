import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── PD Logistic Regression Coefficients (calibrated on NCUA PR data) ──

const PD_COEFFICIENTS: Record<
  string,
  { b0: number; b1: number; b2: number; b3: number; b4: number; b5: number }
> = {
  residential_mortgage: {
    b0: -3.2,
    b1: 12.1,
    b2: 0.08,
    b3: 0.015,
    b4: -0.9,
    b5: 0.002,
  },
  auto_loans: { b0: -2.8, b1: 15.3, b2: 0.11, b3: 0.0, b4: -0.6, b5: 0.003 },
  consumer_loans: { b0: -2.1, b1: 18.7, b2: 0.14, b3: 0.0, b4: 0.0, b5: 0.004 },
  commercial_re: {
    b0: -3.5,
    b1: 10.2,
    b2: 0.07,
    b3: 0.012,
    b4: -1.2,
    b5: 0.001,
  },
  commercial_loans: {
    b0: -3.0,
    b1: 13.5,
    b2: 0.1,
    b3: 0.008,
    b4: -0.8,
    b5: 0.002,
  },
  credit_cards: { b0: -1.5, b1: 22.0, b2: 0.16, b3: 0.0, b4: 0.0, b5: 0.005 },
};

// LGD Haircuts (PR-calibrated from CRIM real estate data)
const LGD_HAIRCUTS: Record<string, number> = {
  residential_re: 0.25,
  commercial_re: 0.35,
  auto: 0.4,
  unsecured: 1.0,
  credit_card: 0.85,
  government: 0.05,
};

// Vasicek asset correlations (Basel II IRB)
const ASSET_CORRELATIONS: Record<string, number> = {
  residential_mortgage: 0.15,
  auto_loans: 0.1,
  consumer_loans: 0.08,
  commercial_re: 0.2,
  commercial_loans: 0.18,
  credit_cards: 0.04,
};

// ─── Types ───────────────────────────────────────────────────

export interface CreditRiskSegment {
  segmentName: string;
  balance: number; // EAD
  annualPD: number; // probability of default (annual)
  lifetimePD: number; // PD over remaining life
  lgd: number; // loss given default
  expectedLoss: number; // EL = PD × LGD × EAD
  unexpectedLoss: number; // UL at 99.9% confidence
  economicCapital: number; // UL × maturity adjustment
  elPct: number; // EL as % of balance
  ecPct: number; // EC as % of balance
}

export interface CreditRiskPortfolio {
  segments: CreditRiskSegment[];
  // Nullable per D1: with no loan segments there is nothing to model, so the
  // engine returns null + a gap rather than PD/EL/EC on fabricated segments.
  totalEAD: number | null;
  totalEL: number | null;
  totalUL: number | null;
  totalEC: number | null;
  portfolioElPct: number | null;
  portfolioEcPct: number | null;
  capitalAdequacy: {
    actualCapital: number;
    requiredEconomicCapital: number;
    capitalSurplus: number;
    isAdequate: boolean;
  } | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class CreditRiskQuantService {
  private readonly logger = new Logger(CreditRiskQuantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyzePortfolio(institutionId: string): Promise<CreditRiskPortfolio> {
    try {
      const loanSegments = await this.prisma.loanSegment.findMany({
        where: { institutionId },
      });
      const institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
      });

      // D1: no loan segments → nothing to model. Refuse rather than compute
      // PD/EL/economic-capital on fabricated demo segments.
      if (loanSegments.length === 0) {
        return this.dataUnavailableResult();
      }

      const segments: CreditRiskSegment[] = loanSegments.map((seg: any) => {
        const segType = this.normalizeType(seg.segmentName);
        const coeffs =
          PD_COEFFICIENTS[segType] ?? PD_COEFFICIENTS.consumer_loans;

        // PD from logistic regression
        // Features: delinquency rate (approx from historical loss), unemployment (PR ~6.5%),
        // LTV (use 0.75 default), DSCR (use 1.3 default), loan age (use maturity/2)
        const delinquencyProxy = seg.historicalLossRate * 1.5;
        const unemployment = 0.065;
        const ltv =
          segType.includes('re') || segType.includes('mortgage') ? 0.75 : 0;
        const dscr = segType.includes('commercial') ? 1.3 : 0;
        const loanAge = (seg.weightedAvgMaturity ?? 5) / 2;

        const logit =
          coeffs.b0 +
          coeffs.b1 * delinquencyProxy +
          coeffs.b2 * unemployment +
          coeffs.b3 * ltv +
          coeffs.b4 * dscr +
          coeffs.b5 * loanAge;
        const annualPD = Math.min(
          0.99,
          Math.max(0.0001, 1 / (1 + Math.exp(-logit))),
        );

        // Lifetime PD: 1 - (1-PD)^maturity
        const maturity = seg.weightedAvgMaturity ?? 5;
        const lifetimePD = 1 - Math.pow(1 - annualPD, maturity);

        // LGD
        const lgdKey = this.getLGDKey(segType);
        const haircut = LGD_HAIRCUTS[lgdKey] ?? 0.5;
        const lgd = haircut; // simplified: LGD = haircut (no collateral recovery model)

        // Expected Loss
        const ead = seg.balance;
        const expectedLoss = lifetimePD * lgd * ead;

        // Unexpected Loss (Vasicek single-factor, 99.9% confidence)
        const rho = ASSET_CORRELATIONS[segType] ?? 0.12;
        const unexpectedLoss = this.vasicekUL(
          annualPD,
          lgd,
          ead,
          rho,
          maturity,
        );

        // Economic Capital = UL × maturity adjustment
        const maturityAdj = this.maturityAdjustment(annualPD, maturity);
        const economicCapital = unexpectedLoss * maturityAdj;

        return {
          segmentName: seg.segmentName,
          balance: ead,
          annualPD: Math.round(annualPD * 10000) / 10000,
          lifetimePD: Math.round(lifetimePD * 10000) / 10000,
          lgd: Math.round(lgd * 1000) / 1000,
          expectedLoss: Math.round(expectedLoss * 100) / 100,
          unexpectedLoss: Math.round(unexpectedLoss * 100) / 100,
          economicCapital: Math.round(economicCapital * 100) / 100,
          elPct: ead > 0 ? Math.round((expectedLoss / ead) * 10000) / 100 : 0,
          ecPct:
            ead > 0 ? Math.round((economicCapital / ead) * 10000) / 100 : 0,
        };
      });

      const totalEAD = segments.reduce((s, seg) => s + Number(seg.balance), 0);
      const totalEL = segments.reduce((s, seg) => s + seg.expectedLoss, 0);
      const totalUL = segments.reduce((s, seg) => s + seg.unexpectedLoss, 0);
      const totalEC = segments.reduce((s, seg) => s + seg.economicCapital, 0);

      // Capital adequacy check
      const totalAssets = institution?.totalAssets ?? totalEAD;
      const equityEstimate = totalAssets * 0.09; // ~9% NWR

      // D1: the capital-adequacy check leans on a 9% NWR proxy when the real
      // total-assets figure is missing — disclose it rather than imply it.
      const gaps: DataGap[] = [];
      if (!institution?.totalAssets) {
        gaps.push(
          dataGap('creditRisk.capitalAdequacy', 'MISSING_TOTAL_ASSETS', {
            severity: 'WARNING',
            action:
              'Total de activos no disponible — la adecuación de capital usa el EAD de la cartera como proxy y un patrimonio estimado del 9% (NWR).',
          }),
        );
      }

      return {
        segments,
        totalEAD,
        totalEL: Math.round(totalEL * 100) / 100,
        totalUL: Math.round(totalUL * 100) / 100,
        totalEC: Math.round(totalEC * 100) / 100,
        portfolioElPct:
          totalEAD > 0 ? Math.round((totalEL / totalEAD) * 10000) / 100 : 0,
        portfolioEcPct:
          totalEAD > 0 ? Math.round((totalEC / totalEAD) * 10000) / 100 : 0,
        capitalAdequacy: {
          actualCapital: Math.round(equityEstimate * 10) / 10,
          requiredEconomicCapital: Math.round(totalEC * 10) / 10,
          capitalSurplus: Math.round((equityEstimate - totalEC) * 10) / 10,
          isAdequate: equityEstimate >= totalEC,
        },
        status: 'ok',
        gaps: gaps.length > 0 ? gaps : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Computation failed: ${error.message}`, error.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  // ─── Vasicek Single-Factor UL ─────────────────────────────

  private vasicekUL(
    pd: number,
    lgd: number,
    ead: number,
    rho: number,
    _maturity: number,
  ): number {
    // UL(99.9%) = [Φ(Φ⁻¹(PD) + √ρ·Φ⁻¹(0.999)) / √(1-ρ)] × LGD × EAD - EL
    const alpha = 0.999;
    const phiInvPD = this.normInv(Math.min(0.9999, Math.max(0.0001, pd)));
    const phiInvAlpha = this.normInv(alpha); // ≈ 3.09

    const conditionalPD = this.normCDF(
      (phiInvPD + Math.sqrt(rho) * phiInvAlpha) / Math.sqrt(1 - rho),
    );

    const ul = conditionalPD * lgd * ead - pd * lgd * ead;
    return Math.max(0, ul);
  }

  // ─── Basel II Maturity Adjustment ─────────────────────────

  private maturityAdjustment(pd: number, maturity: number): number {
    // MA = (1 + (M-2.5) × b) / (1 - 1.5 × b)
    // where b = (0.11852 - 0.05478 × ln(PD))²
    const b = Math.pow(0.11852 - 0.05478 * Math.log(Math.max(0.0001, pd)), 2);
    const ma = (1 + (maturity - 2.5) * b) / (1 - 1.5 * b);
    return Math.max(1, ma);
  }

  // ─── Standard Normal CDF & Inverse ────────────────────────

  private normCDF(x: number): number {
    // Abramowitz & Stegun approximation
    const a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741;
    const a4 = -1.453152027,
      a5 = 1.061405429,
      p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + p * x);
    const y =
      1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }

  private normInv(p: number): number {
    // Rational approximation (Beasley-Springer-Moro)
    if (p <= 0) return -8;
    if (p >= 1) return 8;
    if (p === 0.5) return 0;

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

    const pLow = 0.02425,
      pHigh = 1 - pLow;
    let q, r;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
          q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return (
        -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private normalizeType(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('auto') || n.includes('vehicle')) return 'auto_loans';
    if (
      n.includes('residential') ||
      n.includes('mortgage') ||
      n.includes('first')
    )
      return 'residential_mortgage';
    if (n.includes('commercial') && (n.includes('re') || n.includes('real')))
      return 'commercial_re';
    if (
      n.includes('commercial') ||
      n.includes('industrial') ||
      n.includes('c&i')
    )
      return 'commercial_loans';
    if (n.includes('credit') && n.includes('card')) return 'credit_cards';
    return 'consumer_loans';
  }

  private getLGDKey(segType: string): string {
    if (segType.includes('residential')) return 'residential_re';
    if (segType.includes('commercial_re')) return 'commercial_re';
    if (segType.includes('auto')) return 'auto';
    if (segType.includes('credit_card')) return 'credit_card';
    return 'unsecured';
  }

  // D1 honest shell. Replaces the former getDemoSegments() fallback that
  // produced real-looking PD/EL/economic-capital for an institution with no
  // loan data at all.
  private dataUnavailableResult(): CreditRiskPortfolio {
    return {
      segments: [],
      totalEAD: null,
      totalEL: null,
      totalUL: null,
      totalEC: null,
      portfolioElPct: null,
      portfolioEcPct: null,
      capitalAdequacy: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('creditRisk.loanSegments', 'NO_LOAN_SEGMENTS', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos (saldo, tasa de pérdida histórica, vencimiento) para calcular PD / LGD / pérdida esperada.',
          context: { service: 'credit-risk-quant' },
        }),
      ],
    };
  }
}
