import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

export interface RateRecommendation {
  product: string;
  category: string;
  currentRate: number;
  peerMedianRate: number;
  suggestedRate: number;
  rateDeltaBps: number;
  direction: 'increase' | 'decrease' | 'hold';
  niiImpact: number;
  volumeImpact: string;
  rationale: string;
  rationaleEs: string;
}

export interface NIMOptimizerResult {
  currentNIM: number | null;
  projectedNIM: number | null;
  nimGainBps: number | null;
  totalNIIGain: number | null;
  recommendations: RateRecommendation[];
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

const PEER_RATES: Record<string, number> = {
  consumer_loans: 0.072,
  auto_loans: 0.065,
  residential_mortgage: 0.055,
  commercial_re: 0.058,
  commercial_loans: 0.068,
  credit_cards: 0.145,
  demand_deposits: 0.005,
  savings: 0.015,
  time_deposits: 0.04,
  money_market: 0.025,
  borrowings: 0.052,
};

@Injectable()
export class NIMOptimizerService {
  private readonly logger = new Logger(NIMOptimizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async optimize(institutionId: string): Promise<NIMOptimizerResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    // D1: no balance sheet → refuse rather than fabricate demo NIM
    // recommendations for an institution with no rate data.
    if (items.length === 0) return this.dataUnavailableResult();

    const assets = items.filter((i: any) => i.category === 'asset');
    const liabilities = items.filter((i: any) => i.category === 'liability');
    const totalAssets = assets.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const currentNII =
      assets.reduce((s: number, i: any) => s + i.balance * i.rate, 0) -
      liabilities.reduce((s: number, i: any) => s + i.balance * i.rate, 0);
    const currentNIM = totalAssets > 0 ? (currentNII / totalAssets) * 100 : 3.5;

    const recommendations: RateRecommendation[] = [];
    let totalNIIGain = 0;

    // Aggregate by subcategory
    const bySub = new Map<
      string,
      { balance: number; weightedRate: number; category: string }
    >();
    for (const item of items) {
      const key = item.subcategory;
      if (!bySub.has(key))
        bySub.set(key, {
          balance: 0,
          weightedRate: 0,
          category: item.category,
        });
      const entry = bySub.get(key)!;
      entry.balance += Number(item.balance);
      entry.weightedRate += item.rate * item.balance;
    }

    for (const [sub, entry] of bySub) {
      const avgRate =
        entry.balance > 0 ? entry.weightedRate / entry.balance : 0;
      const peerRate = PEER_RATES[sub];
      if (!peerRate) continue;

      const isAsset = entry.category === 'asset';
      const gap = avgRate - peerRate;
      const gapBps = Math.round(gap * 10000);

      // For assets: if below peer, recommend increase. For liabilities: if above peer, recommend decrease.
      if (isAsset && gapBps < -25) {
        const suggestedRate = peerRate;
        const niiGain = entry.balance * (suggestedRate - avgRate);
        recommendations.push({
          product: sub.replace(/_/g, ' '),
          category: 'asset',
          currentRate: avgRate,
          peerMedianRate: peerRate,
          suggestedRate,
          rateDeltaBps: Math.round((suggestedRate - avgRate) * 10000),
          direction: 'increase',
          niiImpact: Math.round(niiGain * 100) / 100,
          volumeImpact: 'Minimal — rate increase is within competitive range',
          rationale: `Current rate ${(avgRate * 100).toFixed(2)}% is ${Math.abs(gapBps)}bps below peer median of ${(peerRate * 100).toFixed(2)}%. Repricing to peer level adds $${niiGain.toFixed(2)}M NII.`,
          rationaleEs: `La tasa actual de ${(avgRate * 100).toFixed(2)}% está ${Math.abs(gapBps)}bps por debajo de la mediana de pares de ${(peerRate * 100).toFixed(2)}%. Repreciar al nivel de pares agrega $${niiGain.toFixed(2)}M NII.`,
        });
        totalNIIGain += niiGain;
      } else if (!isAsset && gapBps > 25) {
        const suggestedRate = peerRate;
        const niiGain = entry.balance * (avgRate - suggestedRate); // reducing cost = gain
        recommendations.push({
          product: sub.replace(/_/g, ' '),
          category: 'liability',
          currentRate: avgRate,
          peerMedianRate: peerRate,
          suggestedRate,
          rateDeltaBps: Math.round((suggestedRate - avgRate) * 10000),
          direction: 'decrease',
          niiImpact: Math.round(niiGain * 100) / 100,
          volumeImpact:
            'Monitor deposit outflows — use beta library for sensitivity estimate',
          rationale: `Current cost ${(avgRate * 100).toFixed(2)}% is ${gapBps}bps above peer median of ${(peerRate * 100).toFixed(2)}%. Reducing to peer level saves $${niiGain.toFixed(2)}M.`,
          rationaleEs: `El costo actual de ${(avgRate * 100).toFixed(2)}% está ${gapBps}bps por encima de la mediana de pares de ${(peerRate * 100).toFixed(2)}%. Reducir al nivel de pares ahorra $${niiGain.toFixed(2)}M.`,
        });
        totalNIIGain += niiGain;
      }
    }

    recommendations.sort(
      (a, b) => Math.abs(b.niiImpact) - Math.abs(a.niiImpact),
    );
    const projectedNIM =
      totalAssets > 0
        ? ((currentNII + totalNIIGain) / totalAssets) * 100
        : currentNIM;

    return {
      currentNIM: Math.round(currentNIM * 100) / 100,
      projectedNIM: Math.round(projectedNIM * 100) / 100,
      nimGainBps: Math.round((projectedNIM - currentNIM) * 100),
      totalNIIGain: Math.round(totalNIIGain * 100) / 100,
      recommendations,
      status: 'ok',
    };
  }

  // D1 honest shell. Replaces the former getDemoResult() that fabricated NIM
  // optimization recommendations for an institution with no balance sheet.
  private dataUnavailableResult(): NIMOptimizerResult {
    return {
      currentNIM: null,
      projectedNIM: null,
      nimGainBps: null,
      totalNIIGain: null,
      recommendations: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('nimOptimizer.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los activos y pasivos del balance para optimizar el margen de interés neto (NIM).',
          context: { service: 'nim-optimizer' },
        }),
      ],
    };
  }
}
