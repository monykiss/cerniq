import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): concentration VaR is
// computed from the institution's real loan segments (HHI + Vasicek UL + Gordy
// granularity adjustment). An institution with no loan-segment data (or all-zero
// balances) returns an HONEST data_unavailable shell with a CRITICAL gap — NEVER
// a fabricated demo. (Formerly returned a hardcoded HHI 18.5% / $30.3M demo.)

export interface ConcentrationVaRResult {
  // Nullable per D1: with no loan segments there is nothing to measure, so the
  // engine returns `null` + a gap rather than a fabricated demo. `null` is
  // structurally distinct from a real `0` an examiner could act on.
  herfindahlIndex: number | null;
  granularityAdjustment: number | null;
  diversifiedVaR: number | null;
  concentrationVaR: number | null;
  concentrationPremium: number | null;
  concentrationPremiumPct: number | null;
  topConcentrations: Array<{
    segment: string;
    shareOfPortfolio: number;
    el: number;
    ul: number;
  }>;
  narrativeEs: string | null;
  narrativeEn: string | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class CreditConcentrationVaRService {
  private readonly logger = new Logger(CreditConcentrationVaRService.name);

  constructor(private readonly prisma: PrismaService) {}

  async compute(institutionId: string): Promise<ConcentrationVaRResult> {
    try {
      const segments = await this.prisma.loanSegment.findMany({
        where: { institutionId },
      });

      // D1 (never silent zeros): no loan segments — nothing to measure.
      if (segments.length === 0) return this.dataUnavailableResult();

      const totalLoans = segments.reduce(
        (s: number, seg: any) => s + Number(seg.balance),
        0,
      );
      // D1: segments present but zero total balance — still nothing to measure
      // concentration against. Honest shell, never the demo.
      if (totalLoans === 0) return this.dataUnavailableResult();

      // HHI = Σ(s_i²) where s_i = segment_i / total
      const H = segments.reduce(
        (s: number, seg: any) => s + Math.pow(seg.balance / totalLoans, 2),
        0,
      );

      // Per-segment EL and UL
      const segmentRisk = segments.map((seg: any) => {
        const pd = seg.historicalLossRate * 1.5;
        const lgd = seg.lgd;
        const ead = seg.balance;
        const el = pd * lgd * ead;
        const rho = 0.12; // avg asset correlation
        // Vasicek UL approximation
        const ul = this.vasicekUL(pd, lgd, ead, rho);
        return { name: seg.segmentName, ead, el, ul, share: ead / totalLoans };
      });

      const portfolioEL = segmentRisk.reduce(
        (s: number, r: any) => s + r.el,
        0,
      );
      const portfolioUL = Math.sqrt(
        segmentRisk.reduce((s: number, r: any) => s + r.ul ** 2, 0),
      );

      // Gordy granularity adjustment: GA ≈ (H / (1-H)) × (UL²/EL)
      const GA =
        portfolioEL > 0
          ? (H / (1 - H + 1e-10)) * (portfolioUL ** 2 / portfolioEL)
          : 0;

      const diversifiedVaR = portfolioEL + portfolioUL * 3; // 99.9%
      const concentrationVaR = diversifiedVaR + GA;
      const premium = concentrationVaR - diversifiedVaR;
      const premiumPct = diversifiedVaR > 0 ? premium / diversifiedVaR : 0;

      const sorted = [...segmentRisk].sort((a, b) => b.share - a.share);

      const hFormatted = +(H * 100).toFixed(1);
      const isConcentrated = H > 0.15;

      return {
        herfindahlIndex: +H.toFixed(4),
        granularityAdjustment: +GA.toFixed(2),
        diversifiedVaR: +diversifiedVaR.toFixed(2),
        concentrationVaR: +concentrationVaR.toFixed(2),
        concentrationPremium: +premium.toFixed(2),
        concentrationPremiumPct: +premiumPct.toFixed(4),
        topConcentrations: sorted.slice(0, 5).map((r) => ({
          segment: r.name,
          shareOfPortfolio: +r.share.toFixed(3),
          el: +r.el.toFixed(2),
          ul: +r.ul.toFixed(2),
        })),
        narrativeEs: isConcentrated
          ? `Riesgo de concentración elevado (HHI=${hFormatted}%). Los 3 segmentos principales representan ${(sorted.slice(0, 3).reduce((s, r) => s + r.share, 0) * 100).toFixed(0)}% del portafolio. Prima de concentración: $${premium.toFixed(1)}M (${(premiumPct * 100).toFixed(1)}% del VaR diversificado).`
          : `Portafolio bien diversificado (HHI=${hFormatted}%). Prima de concentración es mínima: $${premium.toFixed(1)}M.`,
        narrativeEn: isConcentrated
          ? `Elevated concentration risk (HHI=${hFormatted}%). Top 3 segments represent ${(sorted.slice(0, 3).reduce((s, r) => s + r.share, 0) * 100).toFixed(0)}% of portfolio. Concentration premium: $${premium.toFixed(1)}M (${(premiumPct * 100).toFixed(1)}% of diversified VaR).`
          : `Well-diversified portfolio (HHI=${hFormatted}%). Concentration premium is minimal: $${premium.toFixed(1)}M.`,
        status: 'ok',
      };
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  private vasicekUL(pd: number, lgd: number, ead: number, rho: number): number {
    const normInv = (p: number) => {
      if (p <= 0.0001) return -3.7;
      if (p >= 0.9999) return 3.7;
      const a = [
        -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
        1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
      ];
      const b = [
        -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
        6.680131188771972e1, -1.328068155288572e1,
      ];
      const q = p - 0.5;
      const r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
          q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    };
    const normCDF = (x: number) => {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989422804014327;
      const p =
        d *
        Math.exp((-x * x) / 2) *
        t *
        (0.3193815 +
          t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return x > 0 ? 1 - p : p;
    };

    const conditionalPD = normCDF(
      (normInv(Math.min(0.99, pd)) + Math.sqrt(rho) * normInv(0.999)) /
        Math.sqrt(1 - rho),
    );
    return Math.max(0, (conditionalPD * lgd - pd * lgd) * ead);
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication (HHI 18.5% / diversified $28.5M / concentration $30.3M with three
  // demo segments) that read as a real concentration position on every empty
  // institution.
  private dataUnavailableResult(): ConcentrationVaRResult {
    return {
      herfindahlIndex: null,
      granularityAdjustment: null,
      diversifiedVaR: null,
      concentrationVaR: null,
      concentrationPremium: null,
      concentrationPremiumPct: null,
      topConcentrations: [],
      narrativeEs: null,
      narrativeEn: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('creditConcVaR.loanSegments', 'NO_LOAN_SEGMENTS', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos (con saldos no nulos, tasa de pérdida histórica y LGD) para calcular el VaR de concentración crediticia. / Load loan segments (with non-zero balances, historical loss rate and LGD) to compute credit concentration VaR.',
          context: { service: 'credit-conc-var' },
        }),
      ],
    };
  }
}
