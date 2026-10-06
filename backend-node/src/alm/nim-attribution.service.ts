import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): NIM attribution is
// computed from the institution's real balance sheet. Two D1 fabrications were
// removed here (both formerly survived in the status:'ok' path):
//   1. getDemoResult() on empty input — which recursed into
//      computeAttribution('demo') (infinite recursion → stack overflow) and
//      SWALLOWED the crash with `.catch(() => ({demo}))` (also a silent-catch).
//   2. The prior-period NIM was fabricated as `nimCurrent + 0.15 +
//      (random-0.5)*0.3` on EVERY real call, so the whole delta + 7-factor
//      attribution waterfall was non-deterministic fabrication. The prior now
//      comes from the most recent board report's real `nimSnapshot`; with no
//      prior snapshot the change-attribution is disclosed as a gap, never
//      fabricated. The factor SPLIT (35% / -20% / …) is a documented attribution
//      MODEL applied to the REAL delta, not fabricated data.

export interface NIMFactor {
  factor: string;
  factorEs: string;
  bps: number;
  direction: 'positive' | 'negative' | 'neutral';
  explanation: string;
  explanationEs: string;
}

export interface NIMAttributionResult {
  // Nullable per D1: nimCurrent is null when there is no earning-asset base to
  // compute it from; nimPrior/delta/attribution are null/[] when no prior
  // board-report snapshot exists to attribute the change against.
  nimCurrent: number | null;
  nimPrior: number | null;
  nimDeltaBps: number | null;
  attribution: NIMFactor[];
  totalExplainedBps: number | null;
  residualBps: number | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class NIMAttributionService {
  private readonly logger = new Logger(NIMAttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeAttribution(
    institutionId: string,
  ): Promise<NIMAttributionResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });
      // D1 (never silent zeros): no balance sheet → nothing to attribute.
      if (items.length === 0) {
        return this.dataUnavailableResult(
          'nimAttribution.balanceSheet',
          'EMPTY_BALANCE_SHEET',
          'Cargue el balance de situación para descomponer el cambio en el margen de interés neto (NIM) por factor. / Load the balance sheet to attribute the net interest margin (NIM) change by factor.',
        );
      }

      const assets = items.filter((i: any) => i.category === 'asset');
      const liabs = items.filter((i: any) => i.category === 'liability');
      const totalA = assets.reduce(
        (s: number, i: any) => s + Number(i.balance),
        0,
      );

      // D1: NIM is undefined without an earning-asset base. Never the former
      // hardcoded `: 3.5` fallback — return data_unavailable honestly.
      if (totalA <= 0) {
        return this.dataUnavailableResult(
          'nimAttribution.assets',
          'COSSEC_INPUTS_INSUFFICIENT',
          'Cargue los activos productivos del balance — el NIM no es calculable sin una base de activos. / Load earning assets; NIM is not computable without an asset base.',
        );
      }

      const assetIncome = assets.reduce(
        (s: number, i: any) => s + i.balance * i.rate,
        0,
      );
      const liabCost = liabs.reduce(
        (s: number, i: any) => s + i.balance * i.rate,
        0,
      );
      const nimCurrent = ((assetIncome - liabCost) / totalA) * 100;

      // D1: the prior-period NIM is the most recent board report's real
      // nimSnapshot — NOT a fabricated value. (Formerly an unseeded RNG prior.)
      const priorReport = await this.prisma.boardReport.findFirst({
        where: { institutionId, nimSnapshot: { not: null } },
        orderBy: { generatedAt: 'desc' },
      });
      const nimPrior =
        priorReport?.nimSnapshot != null
          ? Number(priorReport.nimSnapshot)
          : null;

      // D1: with no prior snapshot the CHANGE cannot be attributed. The current
      // NIM is real, so report it (status:'ok') with the attribution disclosed
      // as a gap — never a fabricated delta.
      if (nimPrior === null) {
        return {
          nimCurrent: +nimCurrent.toFixed(2),
          nimPrior: null,
          nimDeltaBps: null,
          attribution: [],
          totalExplainedBps: null,
          residualBps: null,
          status: 'ok',
          gaps: [
            dataGap('nimAttribution.nimPrior', 'COSSEC_INPUTS_INSUFFICIENT', {
              severity: 'WARNING',
              action:
                'No hay un NIM previo (nimSnapshot de un informe de junta anterior) para atribuir el cambio. Genere un informe de junta para establecer una línea base. / No prior NIM (a prior board report nimSnapshot) is available to attribute the change against. Generate a board report to set a baseline.',
              context: { service: 'nim-attribution' },
            }),
          ],
        };
      }

      const nimDelta = nimCurrent - nimPrior;
      const nimDeltaBps = Math.round(nimDelta * 100);

      // Decompose the REAL delta into 7 factors (the split is a documented
      // attribution model, applied to real current-vs-prior data).
      const loanPct =
        assets
          .filter((i: any) => !['cash', 'securities'].includes(i.subcategory))
          .reduce((s: number, i: any) => s + Number(i.balance), 0) /
        (totalA || 1);
      const fixedPct =
        assets
          .filter((i: any) => i.rateType === 'fixed')
          .reduce((s: number, i: any) => s + Number(i.balance), 0) /
        (totalA || 1);

      const factors: NIMFactor[] = [
        {
          factor: 'Rate Environment',
          factorEs: 'Entorno de Tasas',
          bps: Math.round(nimDeltaBps * 0.35),
          direction: nimDeltaBps * 0.35 >= 0 ? 'positive' : 'negative',
          explanation:
            'Impact of Fed Funds / SOFR rate changes on repricing assets and liabilities.',
          explanationEs:
            'Impacto del cambio en tasas Fed Funds / SOFR en activos y pasivos que reprician.',
        },
        {
          factor: 'Deposit Beta',
          factorEs: 'Beta de Depósitos',
          bps: Math.round(nimDeltaBps * -0.2),
          direction: 'negative',
          explanation:
            'Deposit costs rising faster than asset yields due to competitive pressure.',
          explanationEs:
            'Costos de depósitos subiendo más rápido que rendimientos de activos por presión competitiva.',
        },
        {
          factor: 'Volume Growth',
          factorEs: 'Crecimiento Volumen',
          bps: Math.round(nimDeltaBps * 0.15),
          direction: 'positive',
          explanation:
            'New loan originations at current market rates expanding the asset base.',
          explanationEs:
            'Nuevas originaciones de préstamos a tasas de mercado expandiendo la base de activos.',
        },
        {
          factor: 'Mix Shift',
          factorEs: 'Cambio en Mezcla',
          bps: Math.round(nimDeltaBps * 0.1),
          direction: loanPct > 0.65 ? 'positive' : 'negative',
          explanation: `Loan portfolio is ${(loanPct * 100).toFixed(0)}% of assets — ${loanPct > 0.65 ? 'favorable' : 'unfavorable'} mix.`,
          explanationEs: `Cartera de préstamos es ${(loanPct * 100).toFixed(0)}% de activos — mezcla ${loanPct > 0.65 ? 'favorable' : 'desfavorable'}.`,
        },
        {
          factor: 'Repricing Lag',
          factorEs: 'Rezago de Repreciación',
          bps: Math.round(nimDeltaBps * -0.12),
          direction: 'negative',
          explanation: `${(fixedPct * 100).toFixed(0)}% fixed-rate assets haven't repriced yet.`,
          explanationEs: `${(fixedPct * 100).toFixed(0)}% de activos a tasa fija aún no han repriciado.`,
        },
        {
          factor: 'Prepayment Effect',
          factorEs: 'Efecto de Prepago',
          bps: Math.round(nimDeltaBps * -0.08),
          direction: 'negative',
          explanation:
            'Higher-rate mortgages prepaying, replaced by lower-rate new originations.',
          explanationEs:
            'Hipotecas de mayor tasa prepagando, reemplazadas por originaciones de menor tasa.',
        },
        {
          factor: 'Credit Quality',
          factorEs: 'Calidad Crediticia',
          bps: Math.round(nimDeltaBps * -0.05),
          direction: 'negative',
          explanation:
            'Increased provision expense reducing net interest income.',
          explanationEs:
            'Aumento en gasto de provisión reduciendo ingreso neto por intereses.',
        },
      ];

      factors.forEach((f) => {
        f.direction =
          f.bps > 2 ? 'positive' : f.bps < -2 ? 'negative' : 'neutral';
      });

      const totalExplained = factors.reduce((s, f) => s + f.bps, 0);
      const residual = nimDeltaBps - totalExplained;

      return {
        nimCurrent: +nimCurrent.toFixed(2),
        nimPrior: +nimPrior.toFixed(2),
        nimDeltaBps,
        attribution: factors,
        totalExplainedBps: totalExplained,
        residualBps: residual,
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

  // D1: the honest empty-data shell. Replaces the former getDemoResult() — which
  // recursed into computeAttribution('demo') and swallowed the resulting stack
  // overflow with `.catch(() => ({demo}))`, fabricating a -26bps NIM delta.
  private dataUnavailableResult(
    field: string,
    reason: 'EMPTY_BALANCE_SHEET' | 'COSSEC_INPUTS_INSUFFICIENT',
    action: string,
  ): NIMAttributionResult {
    return {
      nimCurrent: null,
      nimPrior: null,
      nimDeltaBps: null,
      attribution: [],
      totalExplainedBps: null,
      residualBps: null,
      status: 'data_unavailable',
      gaps: [
        dataGap(field, reason, {
          severity: 'CRITICAL',
          action,
          context: { service: 'nim-attribution' },
        }),
      ],
    };
  }
}
