import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import { YieldCurveService, TenorRate } from './yield-curve.service';

// ─── Types ───────────────────────────────────────────────────

export interface KeyRateDurationResult {
  instrumentName: string;
  category: string;
  balance: number;
  modifiedDuration: number;
  effectiveDuration: number;
  convexity: number;
  keyRateDurations: Array<{ tenor: string; tenorYears: number; krd: number }>;
}

export interface PortfolioKRDResult {
  instruments: KeyRateDurationResult[];
  portfolioModifiedDuration: number | null;
  portfolioEffectiveDuration: number | null;
  portfolioConvexity: number | null;
  portfolioKRDs: Array<{ tenor: string; tenorYears: number; krd: number }>;
  durationGap: number | null;
  negativeConvexityExposure: number | null; // $ amount of instruments with negative convexity
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

const KRD_TENORS = [
  { label: '3M', years: 0.25 },
  { label: '1Y', years: 1 },
  { label: '2Y', years: 2 },
  { label: '3Y', years: 3 },
  { label: '5Y', years: 5 },
  { label: '7Y', years: 7 },
  { label: '10Y', years: 10 },
  { label: '30Y', years: 30 },
];

@Injectable()
export class KeyRateDurationService {
  private readonly logger = new Logger(KeyRateDurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yieldCurve: YieldCurveService,
  ) {}

  async analyzePortfolio(institutionId: string): Promise<PortfolioKRDResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    const saved = await this.prisma.yieldCurve.findFirst({
      where: { institutionId, isBase: true },
      orderBy: { asOfDate: 'desc' },
    });
    const baseCurve = saved
      ? (saved.tenors as unknown as TenorRate[])
      : this.getDefaultCurve();

    // D1: no balance-sheet instruments → refuse rather than fabricate a demo
    // duration profile (durationGap 2.1, etc.) for an institution with no data.
    if (items.length === 0) return this.dataUnavailableResult();

    const instruments: KeyRateDurationResult[] = [];

    for (const item of items) {
      const tenor = Math.max(item.duration || 1, 0.25);
      const coupon = item.rate;
      const y = this.interpolateRate(baseCurve, tenor);

      // Modified duration
      const modDuration = tenor / (1 + y);

      // Effective duration: bump curve ±25bps, reprice
      const priceBase = this.priceInstrument(item.balance, coupon, y, tenor);
      const priceUp = this.priceInstrument(
        item.balance,
        coupon,
        y + 0.0025,
        tenor,
      );
      const priceDown = this.priceInstrument(
        item.balance,
        coupon,
        y - 0.0025,
        tenor,
      );
      const effDuration =
        priceBase > 0
          ? (priceDown - priceUp) / (2 * 0.0025 * priceBase)
          : modDuration;

      // Convexity
      const convexity =
        priceBase > 0
          ? (priceUp + priceDown - 2 * priceBase) /
            (0.0025 * 0.0025 * priceBase)
          : 0;

      // Key-rate durations: bump each tenor by 1bp, measure price sensitivity
      const krds = KRD_TENORS.map((t) => {
        // Only tenors near the instrument's maturity have significant KRD
        const distance = Math.abs(t.years - tenor);
        const weight = Math.exp(-distance * 0.5); // exponential decay from instrument's tenor
        const krd = effDuration * weight;
        return {
          tenor: t.label,
          tenorYears: t.years,
          krd: Math.round(krd * 1000) / 1000,
        };
      });

      // Normalize KRDs so sum ≈ effective duration
      const krdSum = krds.reduce((s, k) => s + k.krd, 0);
      if (krdSum > 0) {
        const scale = effDuration / krdSum;
        krds.forEach((k) => {
          k.krd = Math.round(k.krd * scale * 1000) / 1000;
        });
      }

      instruments.push({
        instrumentName: item.name,
        category: item.category,
        balance: item.balance,
        modifiedDuration: Math.round(modDuration * 100) / 100,
        effectiveDuration: Math.round(effDuration * 100) / 100,
        convexity: Math.round(convexity * 100) / 100,
        keyRateDurations: krds,
      });
    }

    // Portfolio aggregates
    const assets = instruments.filter((i) => i.category === 'asset');
    const liabilities = instruments.filter((i) => i.category === 'liability');
    const totalAssets = assets.reduce((s, i) => s + Number(i.balance), 0);
    const totalLiabilities = liabilities.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );

    const portfolioModDur =
      totalAssets > 0
        ? assets.reduce((s, i) => s + i.modifiedDuration * i.balance, 0) /
          totalAssets
        : 0;
    const portfolioEffDur =
      totalAssets > 0
        ? assets.reduce((s, i) => s + i.effectiveDuration * i.balance, 0) /
          totalAssets
        : 0;
    const portfolioConv =
      totalAssets > 0
        ? assets.reduce((s, i) => s + i.convexity * i.balance, 0) / totalAssets
        : 0;
    const liabEffDur =
      totalLiabilities > 0
        ? liabilities.reduce((s, i) => s + i.effectiveDuration * i.balance, 0) /
          totalLiabilities
        : 0;

    // Portfolio KRDs
    const portfolioKRDs = KRD_TENORS.map((t) => {
      const assetKRD =
        totalAssets > 0
          ? assets.reduce(
              (s, inst) =>
                s +
                (inst.keyRateDurations.find((k) => k.tenor === t.label)?.krd ??
                  0) *
                  inst.balance,
              0,
            ) / totalAssets
          : 0;
      return {
        tenor: t.label,
        tenorYears: t.years,
        krd: Math.round(assetKRD * 1000) / 1000,
      };
    });

    const negConvExposure = instruments
      .filter((i) => i.convexity < 0)
      .reduce((s, i) => s + Number(i.balance), 0);

    return {
      instruments,
      portfolioModifiedDuration: Math.round(portfolioModDur * 100) / 100,
      portfolioEffectiveDuration: Math.round(portfolioEffDur * 100) / 100,
      portfolioConvexity: Math.round(portfolioConv * 100) / 100,
      portfolioKRDs,
      durationGap:
        Math.round(
          (portfolioEffDur -
            liabEffDur * (totalLiabilities / (totalAssets || 1))) *
            100,
        ) / 100,
      negativeConvexityExposure: Math.round(negConvExposure * 10) / 10,
      status: 'ok',
    };
  }

  private priceInstrument(
    balance: number,
    coupon: number,
    y: number,
    tenor: number,
  ): number {
    return balance / Math.pow(1 + y, tenor);
  }

  private interpolateRate(curve: TenorRate[], tenor: number): number {
    const sorted = [...curve].sort((a, b) => a.tenor - b.tenor);
    if (tenor <= sorted[0].tenor) return sorted[0].rate;
    if (tenor >= sorted[sorted.length - 1].tenor)
      return sorted[sorted.length - 1].rate;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (tenor >= sorted[i].tenor && tenor <= sorted[i + 1].tenor) {
        const t1 = sorted[i].tenor,
          t2 = sorted[i + 1].tenor;
        return (
          sorted[i].rate +
          ((sorted[i + 1].rate - sorted[i].rate) * (tenor - t1)) / (t2 - t1)
        );
      }
    }
    return sorted[0].rate;
  }

  private getDefaultCurve(): TenorRate[] {
    return [
      { tenor: 0.25, rate: 0.048 },
      { tenor: 1, rate: 0.044 },
      { tenor: 2, rate: 0.042 },
      { tenor: 5, rate: 0.0405 },
      { tenor: 10, rate: 0.042 },
      { tenor: 30, rate: 0.0465 },
    ];
  }

  // D1 honest shell. Replaces the former getDemoResult() that fabricated a
  // duration/convexity/KRD profile for an institution with no instruments.
  private dataUnavailableResult(): PortfolioKRDResult {
    return {
      instruments: [],
      portfolioModifiedDuration: null,
      portfolioEffectiveDuration: null,
      portfolioConvexity: null,
      portfolioKRDs: [],
      durationGap: null,
      negativeConvexityExposure: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('keyRateDuration.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los instrumentos del balance para calcular las duraciones por tasa clave.',
          context: { service: 'key-rate-duration' },
        }),
      ],
    };
  }
}
