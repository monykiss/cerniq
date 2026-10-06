import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// Wrong-Way Risk — Exposure increases when counterparty most likely to default
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): CVA is computed from
// the institution's real loan segments. An institution with no loan-segment data
// returns an HONEST data_unavailable shell with a CRITICAL gap — NEVER a
// fabricated demo CVA. (This service formerly returned a hardcoded $3.8M demo.)

export interface WWRResult {
  // Nullable per D1: with no loan segments there is nothing to compute, so the
  // engine returns `null` + a gap rather than a fabricated demo CVA. `null` is
  // structurally distinct from a real `0` an examiner could act on.
  naiveCVA: number | null;
  adjustedCVA: number | null;
  wwrPremium: number | null;
  wwrMultiplier: number | null;
  bySegment: Array<{
    segment: string;
    naiveCVA: number;
    adjustedCVA: number;
    premium: number;
  }>;
  narrativeEs: string | null;
  narrativeEn: string | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class WrongWayRiskService {
  private readonly logger = new Logger(WrongWayRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeWWR(
    institutionId: string,
    wwrCorrelation: number = 0.3,
  ): Promise<WWRResult> {
    try {
      const segments = await this.prisma.loanSegment.findMany({
        where: { institutionId },
      });
      // D1 (never silent zeros): no loan segments means there is nothing to
      // compute CVA on. Return an honest data_unavailable shell with a CRITICAL
      // gap — NEVER the former hardcoded $3.8M getDemoResult() fabrication.
      if (segments.length === 0) return this.dataUnavailableResult();

      let totalNaive = 0,
        totalAdjusted = 0;
      const bySegment: WWRResult['bySegment'] = [];

      for (const seg of segments) {
        const pd = seg.historicalLossRate * 1.5;
        const lgd = seg.lgd;
        const ead = seg.balance;
        const maturity = seg.weightedAvgMaturity ?? 3;
        const vol = 0.15; // exposure volatility

        // Naive CVA = LGD × PD × EAD × maturity
        const naiveCVA = (lgd * pd * ead * maturity) / 4; // quarterly

        // WWR adjustment: E[X|D=1] = E[X] × (1 + ρ × σ × Φ⁻¹(PD) / PD)
        const normInvPD = this.normInv(1 - pd);
        const wwrAdj = 1 + (wwrCorrelation * vol * normInvPD) / (pd || 1e-6);
        const adjustedEPE = ead * Math.max(0.5, Math.min(3.0, wwrAdj));
        const adjustedCVA = (lgd * pd * adjustedEPE * maturity) / 4;

        totalNaive += naiveCVA;
        totalAdjusted += adjustedCVA;
        bySegment.push({
          segment: seg.segmentName,
          naiveCVA: +naiveCVA.toFixed(3),
          adjustedCVA: +adjustedCVA.toFixed(3),
          premium: +(adjustedCVA - naiveCVA).toFixed(3),
        });
      }

      const premium = totalAdjusted - totalNaive;
      const multiplier = totalNaive > 0 ? totalAdjusted / totalNaive : 1;

      return {
        naiveCVA: +totalNaive.toFixed(2),
        adjustedCVA: +totalAdjusted.toFixed(2),
        wwrPremium: +premium.toFixed(2),
        wwrMultiplier: +multiplier.toFixed(3),
        bySegment,
        narrativeEs: `El CVA ajustado por wrong-way risk es $${totalAdjusted.toFixed(1)}M (${multiplier.toFixed(1)}× el CVA naive de $${totalNaive.toFixed(1)}M). La prima WWR de $${premium.toFixed(1)}M refleja que la exposición crediticia aumenta precisamente cuando la probabilidad de incumplimiento es mayor.`,
        narrativeEn: `WWR-adjusted CVA is $${totalAdjusted.toFixed(1)}M (${multiplier.toFixed(1)}× naive CVA of $${totalNaive.toFixed(1)}M). The WWR premium of $${premium.toFixed(1)}M reflects that credit exposure increases precisely when default probability is highest.`,
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

  private normInv(p: number): number {
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
    const q = p - 0.5,
      r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication (naive $2.4M / adjusted $3.8M / 1.58× multiplier with two demo
  // segments) that read as a real CVA position on every empty institution.
  private dataUnavailableResult(): WWRResult {
    return {
      naiveCVA: null,
      adjustedCVA: null,
      wwrPremium: null,
      wwrMultiplier: null,
      bySegment: [],
      narrativeEs: null,
      narrativeEn: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('wrongWayRisk.loanSegments', 'NO_LOAN_SEGMENTS', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos (con tasa de pérdida histórica, LGD y saldo) para calcular el CVA ajustado por wrong-way risk. / Load loan segments (with historical loss rate, LGD and balance) to compute wrong-way-risk-adjusted CVA.',
          context: { service: 'wrong-way-risk' },
        }),
      ],
    };
  }
}
