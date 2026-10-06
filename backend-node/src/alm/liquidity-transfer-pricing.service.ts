import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── Internal Funding Curve ─────────────────────────────────

const INTERNAL_FUNDING_CURVE: Array<{
  bucket: string;
  minYears: number;
  maxYears: number;
  fundingCost: number;
  riskFreeRate: number;
  liquidityPremium: number;
}> = [
  {
    bucket: '0-3M',
    minYears: 0,
    maxYears: 0.25,
    fundingCost: 0.05,
    riskFreeRate: 0.048,
    liquidityPremium: 0.002,
  },
  {
    bucket: '3-12M',
    minYears: 0.25,
    maxYears: 1,
    fundingCost: 0.047,
    riskFreeRate: 0.044,
    liquidityPremium: 0.003,
  },
  {
    bucket: '1-3Y',
    minYears: 1,
    maxYears: 3,
    fundingCost: 0.045,
    riskFreeRate: 0.041,
    liquidityPremium: 0.004,
  },
  {
    bucket: '3-5Y',
    minYears: 3,
    maxYears: 5,
    fundingCost: 0.046,
    riskFreeRate: 0.0405,
    liquidityPremium: 0.0055,
  },
  {
    bucket: '5-10Y',
    minYears: 5,
    maxYears: 10,
    fundingCost: 0.048,
    riskFreeRate: 0.042,
    liquidityPremium: 0.006,
  },
  {
    bucket: '>10Y',
    minYears: 10,
    maxYears: 999,
    fundingCost: 0.052,
    riskFreeRate: 0.046,
    liquidityPremium: 0.006,
  },
];

export interface LTPSegment {
  segment: string;
  category: string;
  balance: number;
  matchedBucket: string;
  liquidityPremium: number; // bps
  liquidityCharge: number; // $ annual charge to this segment
  beforeLTP_NIM: number; // segment NIM before LTP
  afterLTP_NIM: number; // segment NIM after LTP charge
  isLiquidityConsumer: boolean;
}

export interface LTPResult {
  segments: LTPSegment[];
  internalFundingCurve: typeof INTERNAL_FUNDING_CURVE;
  totalLiquidityCharge: number | null;
  totalLiquidityCredit: number | null;
  netLTPTransfer: number | null;
  topConsumers: string[];
  topProviders: string[];
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class LiquidityTransferPricingService {
  private readonly logger = new Logger(LiquidityTransferPricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeLTP(institutionId: string): Promise<LTPResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    // D1: no balance sheet → refuse rather than fabricate a demo liquidity
    // transfer-pricing breakdown for an institution with no data.
    if (items.length === 0) return this.dataUnavailableResult();

    // Aggregate by subcategory
    const bySub = new Map<
      string,
      { balance: number; rate: number; category: string; duration: number }
    >();
    for (const item of items) {
      if (!bySub.has(item.subcategory)) {
        bySub.set(item.subcategory, {
          balance: 0,
          rate: 0,
          category: item.category,
          duration: 0,
        });
      }
      const e = bySub.get(item.subcategory)!;
      e.balance += Number(item.balance);
      e.rate += item.rate * item.balance;
      e.duration += item.duration * item.balance;
    }

    const segments: LTPSegment[] = [];
    let totalCharge = 0;
    let totalCredit = 0;

    for (const [sub, entry] of bySub) {
      const avgRate = entry.balance > 0 ? entry.rate / entry.balance : 0;
      const avgDuration =
        entry.balance > 0 ? entry.duration / entry.balance : 1;
      const isAsset = entry.category === 'asset';

      const bucket =
        INTERNAL_FUNDING_CURVE.find(
          (b) => avgDuration >= b.minYears && avgDuration < b.maxYears,
        ) ?? INTERNAL_FUNDING_CURVE[INTERNAL_FUNDING_CURVE.length - 1];

      // Assets consume liquidity → charged. Liabilities provide → credited.
      const liquidityPremiumBps = Math.round(bucket.liquidityPremium * 10000);
      const annualCharge = isAsset
        ? entry.balance * bucket.liquidityPremium // charge on assets
        : -entry.balance * bucket.liquidityPremium; // credit on liabilities

      const beforeNIM = avgRate * 100;
      const afterNIM = isAsset
        ? (avgRate - bucket.liquidityPremium) * 100
        : (avgRate + bucket.liquidityPremium) * 100;

      if (annualCharge > 0) totalCharge += annualCharge;
      else totalCredit += Math.abs(annualCharge);

      segments.push({
        segment: sub.replace(/_/g, ' '),
        category: entry.category,
        balance: entry.balance,
        matchedBucket: bucket.bucket,
        liquidityPremium: liquidityPremiumBps,
        liquidityCharge: Math.round(annualCharge * 100) / 100,
        beforeLTP_NIM: Math.round(beforeNIM * 100) / 100,
        afterLTP_NIM: Math.round(afterNIM * 100) / 100,
        isLiquidityConsumer: isAsset,
      });
    }

    segments.sort(
      (a, b) => Math.abs(b.liquidityCharge) - Math.abs(a.liquidityCharge),
    );

    return {
      segments,
      internalFundingCurve: INTERNAL_FUNDING_CURVE,
      totalLiquidityCharge: Math.round(totalCharge * 100) / 100,
      totalLiquidityCredit: Math.round(totalCredit * 100) / 100,
      netLTPTransfer: Math.round((totalCharge - totalCredit) * 100) / 100,
      topConsumers: segments
        .filter((s) => s.liquidityCharge > 0)
        .slice(0, 3)
        .map((s) => s.segment),
      topProviders: segments
        .filter((s) => s.liquidityCharge < 0)
        .slice(0, 3)
        .map((s) => s.segment),
      status: 'ok',
    };
  }

  // D1 honest shell. Replaces the former getDemoResult() that fabricated a
  // 5-segment liquidity transfer-pricing breakdown for an empty balance sheet.
  private dataUnavailableResult(): LTPResult {
    return {
      segments: [],
      internalFundingCurve: INTERNAL_FUNDING_CURVE,
      totalLiquidityCharge: null,
      totalLiquidityCredit: null,
      netLTPTransfer: null,
      topConsumers: [],
      topProviders: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('ltp.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los activos y pasivos del balance para calcular el precio de transferencia de liquidez (LTP).',
          context: { service: 'liquidity-transfer-pricing' },
        }),
      ],
    };
  }
}
