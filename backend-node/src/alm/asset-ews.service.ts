import { Injectable, Logger } from '@nestjs/common';
import type { BalanceSheetItem, LoanSegment } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── 12 EWS Leading Indicators ──────────────────────────────

const EWS_INDICATORS = [
  {
    id: 'delinquency_30d',
    name: '30-Day Delinquency Rate',
    nameEs: 'Tasa Morosidad 30 Días',
    weight: 12,
  },
  {
    id: 'delinquency_90d',
    name: '90-Day Delinquency Rate',
    nameEs: 'Tasa Morosidad 90 Días',
    weight: 15,
  },
  { id: 'npl_ratio', name: 'NPL Ratio', nameEs: 'Ratio NPL', weight: 12 },
  {
    id: 'chargeoff_rate',
    name: 'Charge-Off Rate (4Q)',
    nameEs: 'Tasa Castigos (4T)',
    weight: 10,
  },
  {
    id: 'delinquency_trend',
    name: 'Delinquency QoQ Change',
    nameEs: 'Cambio Morosidad T/T',
    weight: 10,
  },
  {
    id: 'ltv_re',
    name: 'Avg LTV (RE Loans)',
    nameEs: 'LTV Promedio (Préstamos RE)',
    weight: 8,
  },
  {
    id: 'dscr_commercial',
    name: 'Avg DSCR (Commercial)',
    nameEs: 'DSCR Promedio (Comercial)',
    weight: 5,
  },
  {
    id: 'classified_ratio',
    name: 'Classified Asset Ratio',
    nameEs: 'Ratio Activos Clasificados',
    weight: 8,
  },
  {
    id: 'oreo_growth',
    name: 'OREO Growth Rate',
    nameEs: 'Tasa Crecimiento OREO',
    weight: 5,
  },
  {
    id: 'consumer_60d_delta',
    name: 'Consumer 60-Day Δ',
    nameEs: 'Δ Consumo 60 Días',
    weight: 5,
  },
  {
    id: 'allowance_coverage',
    name: 'Allowance Coverage',
    nameEs: 'Cobertura Provisión',
    weight: 5,
  },
  {
    id: 'peer_delinquency_gap',
    name: 'Peer Delinquency Gap',
    nameEs: 'Brecha Morosidad Pares',
    weight: 5,
  },
];

/**
 * Indicators that CerniQ actually derives from available data today: each is a
 * function of the portfolio's weighted-average historical loss rate (a proxy,
 * disclosed as such). Their combined weight is 57/100.
 *
 * The remaining 7 indicators (LTV, DSCR, OREO growth, allowance coverage, peer
 * gap, delinquency trend, consumer 60-day Δ) have NO data source wired yet — D1
 * forbids presenting a hardcoded constant as a measurement, so they return
 * `value: null` + a WARNING gap until a real feed (roadmap W1.2 / W2.0) lands.
 */
const DERIVED_INDICATORS: Record<
  string,
  { factor: number; yellow: number; red: number }
> = {
  delinquency_30d: { factor: 1.5, yellow: 2.0, red: 4.0 },
  delinquency_90d: { factor: 0.8, yellow: 1.0, red: 2.5 },
  npl_ratio: { factor: 1.2, yellow: 2.0, red: 5.0 },
  chargeoff_rate: { factor: 0.6, yellow: 0.8, red: 1.5 },
  classified_ratio: { factor: 2, yellow: 3.0, red: 6.0 },
};

// Minimum fraction of total indicator weight that must be measured before we
// will assign an asset-quality grade. Below this, we refuse to score (D1) —
// grading on a minority of indicators would be "GREEN by omission".
const MIN_MEASURED_WEIGHT_FRACTION = 0.5;

// ─── Types ───────────────────────────────────────────────────

export interface EWSIndicator {
  id: string;
  name: string;
  nameEs: string;
  value: number | null; // null = not measured (unwired or no data)
  trend: 'improving' | 'stable' | 'deteriorating';
  alertLevel: 'green' | 'yellow' | 'red' | 'data_unavailable';
  weight: number;
  contribution: number; // to composite score
}

export interface EWSResult {
  compositeScore: number | null; // 0-100 (higher = better); null when unscored
  alertLevel: 'GREEN' | 'YELLOW' | 'RED' | 'DATA_UNAVAILABLE';
  indicators: EWSIndicator[];
  topDeteriorating: EWSIndicator[];
  peerAlert: string;
  peerAlertEs: string;
  anomalyScore: number | null; // Isolation Forest output 0-1; null when unscored
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class AssetEWSService {
  private readonly logger = new Logger(AssetEWSService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeEWS(institutionId: string): Promise<EWSResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const loanSegments = await this.prisma.loanSegment.findMany({
      where: { institutionId },
    });

    const totalLoans = items
      .filter(
        (i: BalanceSheetItem) =>
          i.category === 'asset' &&
          !['cash', 'securities'].includes(i.subcategory),
      )
      .reduce((s: number, i: BalanceSheetItem) => s + Number(i.balance), 0);

    // D1 (never silent zeros): no loan portfolio at all → there is nothing to
    // assess. Return an honest shell instead of fabricating a healthy score.
    if (loanSegments.length === 0 && totalLoans === 0) {
      return this.dataUnavailableResult([
        dataGap('ews.portfolio', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos y el balance de situación para evaluar la calidad de activos.',
          context: { service: 'asset-ews' },
        }),
      ]);
    }

    // The derived indicators need a weighted-average loss rate, which requires
    // loan segments carrying historical loss data over a non-zero loan book.
    const haveLossData = loanSegments.length > 0 && totalLoans > 0;
    const avgLossRate = haveLossData
      ? loanSegments.reduce(
          (s: number, seg: LoanSegment) =>
            s + Number(seg.historicalLossRate) * Number(seg.balance),
          0,
        ) / totalLoans
      : null;

    const gaps: DataGap[] = [];
    const indicators = this.computeIndicators(avgLossRate, gaps);

    const measured = indicators.filter((i) => i.value !== null);
    const measuredWeight = measured.reduce((s, i) => s + i.weight, 0);
    const totalWeight = indicators.reduce((s, i) => s + i.weight, 0);

    // D1: refuse to grade asset quality on less than half the indicator weight.
    if (measuredWeight < totalWeight * MIN_MEASURED_WEIGHT_FRACTION) {
      if (!haveLossData) {
        gaps.unshift(
          dataGap('ews.lossHistory', 'EWS_INPUTS_INSUFFICIENT', {
            severity: 'CRITICAL',
            action:
              'Cargue el historial de pérdidas por segmento (historicalLossRate) para calcular los indicadores de morosidad.',
            context: { service: 'asset-ews' },
          }),
        );
      }
      return this.dataUnavailableResult(gaps, indicators);
    }

    const compositeScore = Math.round(
      (measured.reduce((s, i) => s + i.contribution, 0) / measuredWeight) * 100,
    );
    const alertLevel =
      compositeScore >= 75 ? 'GREEN' : compositeScore >= 50 ? 'YELLOW' : 'RED';

    const anomalyScore = this.isolationForestScore(indicators);

    const topDeteriorating = indicators
      .filter((i) => i.trend === 'deteriorating')
      .sort((a, b) => a.contribution - b.contribution)
      .slice(0, 3);

    // Peer alert is only meaningful when the peer-gap indicator is measured.
    const peerGapIndicator = indicators.find(
      (i) => i.id === 'peer_delinquency_gap',
    );
    const peerMeasured = !!peerGapIndicator && peerGapIndicator.value !== null;
    const peerDiverged =
      peerMeasured && peerGapIndicator.alertLevel !== 'green';
    const peerAlert = !peerMeasured
      ? `Peer comparison unavailable — the peer benchmark feed is not yet wired.`
      : peerDiverged
        ? `Your delinquency rate diverged from peer median — review consumer and CRE portfolios.`
        : `Asset quality is within peer group norms.`;
    const peerAlertEs = !peerMeasured
      ? `Comparación con pares no disponible — la fuente de referencia de pares aún no está conectada.`
      : peerDiverged
        ? `Su tasa de morosidad divergió de la mediana de pares — revise carteras de consumo y CRE.`
        : `La calidad de activos está dentro de normas del grupo de pares.`;

    return {
      compositeScore,
      alertLevel,
      indicators,
      topDeteriorating,
      peerAlert,
      peerAlertEs,
      anomalyScore: Math.round(anomalyScore * 100) / 100,
      status: 'ok',
      gaps: gaps.length > 0 ? gaps : undefined,
    };
  }

  // ─── Compute Individual Indicators ────────────────────────

  private computeIndicators(
    avgLossRate: number | null,
    gaps: DataGap[],
  ): EWSIndicator[] {
    return EWS_INDICATORS.map((ind) => {
      const derived = DERIVED_INDICATORS[ind.id];

      if (derived) {
        // Wired indicator — but only computable when loss history exists.
        if (avgLossRate === null) {
          return this.nullIndicator(ind);
        }
        const value = avgLossRate * 100 * derived.factor;
        const alertLevel =
          value >= derived.red
            ? 'red'
            : value >= derived.yellow
              ? 'yellow'
              : 'green';
        const contribution =
          alertLevel === 'green'
            ? ind.weight
            : alertLevel === 'yellow'
              ? ind.weight * 0.5
              : 0;
        return {
          ...ind,
          value: Math.round(value * 100) / 100,
          trend:
            alertLevel === 'red'
              ? ('deteriorating' as const)
              : alertLevel === 'yellow'
                ? ('stable' as const)
                : ('improving' as const),
          alertLevel,
          contribution,
        };
      }

      // Unwired indicator: D1 forbids presenting a constant as a measurement.
      gaps.push(
        dataGap(`ews.indicator.${ind.id}`, 'INDICATOR_NOT_WIRED', {
          severity: 'WARNING',
          action: `Conecte la fuente de datos para "${ind.nameEs}" (indicador aún no instrumentado).`,
          context: { indicator: ind.id },
        }),
      );
      return this.nullIndicator(ind);
    });
  }

  private nullIndicator(ind: (typeof EWS_INDICATORS)[number]): EWSIndicator {
    return {
      ...ind,
      value: null,
      trend: 'stable',
      alertLevel: 'data_unavailable',
      contribution: 0,
    };
  }

  // ─── Isolation Forest (simplified) ────────────────────────

  private isolationForestScore(indicators: EWSIndicator[]): number {
    // Simplified anomaly score: normalized distance from "healthy" center.
    // Only measured (green/yellow/red) indicators contribute; unavailable
    // indicators are excluded rather than treated as healthy.
    const redCount = indicators.filter((i) => i.alertLevel === 'red').length;
    const yellowCount = indicators.filter(
      (i) => i.alertLevel === 'yellow',
    ).length;

    // Heuristic: each red adds 0.08, each yellow adds 0.03
    const rawScore = 0.3 + redCount * 0.08 + yellowCount * 0.03;
    return Math.min(1.0, Math.max(0, rawScore));
  }

  // D1 honest shell. Replaces the former path that fabricated a full set of
  // indicators (avgLossRate=0.015, totalLoans=300) and a ~72 composite for an
  // institution that had uploaded nothing — which read as "healthy" to a board.
  private dataUnavailableResult(
    gaps: DataGap[],
    indicators?: EWSIndicator[],
  ): EWSResult {
    return {
      compositeScore: null,
      alertLevel: 'DATA_UNAVAILABLE',
      indicators:
        indicators ?? EWS_INDICATORS.map((ind) => this.nullIndicator(ind)),
      topDeteriorating: [],
      peerAlert: `Asset-quality early warning unavailable — load portfolio data.`,
      peerAlertEs: `Alerta temprana de calidad de activos no disponible — cargue datos de cartera.`,
      anomalyScore: null,
      status: 'data_unavailable',
      gaps: gaps.length > 0 ? gaps : undefined,
    };
  }
}
