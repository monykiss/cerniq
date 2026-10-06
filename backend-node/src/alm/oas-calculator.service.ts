import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import { YieldCurveService, TenorRate } from './yield-curve.service';
import * as Sentry from '@sentry/nestjs';

// ─── Types ───────────────────────────────────────────────────

export interface OASResult {
  instrumentId: string;
  instrumentName: string;
  category: string;
  balance: number;
  nominalSpread: number; // bps above benchmark
  zSpread: number; // zero-volatility spread
  oas: number; // option-adjusted spread
  optionCost: number; // zSpread - OAS (cost of embedded option)
  effectiveDuration: number;
  effectiveConvexity: number;
  modifiedDuration: number;
}

export interface OASPortfolioResult {
  instruments: OASResult[];
  portfolioOAS: number | null; // balance-weighted OAS
  portfolioEffDuration: number | null;
  portfolioEffConvexity: number | null;
  totalOptionCost: number | null; // $ total option cost
  totalBalance: number | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

// PSA Prepayment Speeds
const PSA_BASE_CPR = 0.06; // 6% base CPR (100% PSA)
const PR_LOYALTY_DISCOUNT = 0.8; // PR cooperatives 20% less likely to prepay

@Injectable()
export class OASCalculatorService {
  private readonly logger = new Logger(OASCalculatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yieldCurve: YieldCurveService,
  ) {}

  // ─── Full Portfolio OAS Analysis ──────────────────────────

  async analyzePortfolio(institutionId: string): Promise<OASPortfolioResult> {
    try {
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

      // D1: no balance sheet → refuse rather than fabricate a demo OAS
      // portfolio (FHLB callables, MBS pools) for an empty institution.
      if (items.length === 0) return this.dataUnavailableResult();

      const instruments: OASResult[] = [];

      for (const item of items) {
        if (item.category !== 'asset') continue;

        const hasOption = this.hasEmbeddedOption(item);
        const tenor = Math.max(item.duration || 1, 0.25);
        const couponRate = item.rate;
        const benchmarkRate = this.interpolateRate(baseCurve, tenor);

        // Nominal spread
        const nominalSpread = (couponRate - benchmarkRate) * 10000;

        // Z-Spread: constant spread over entire curve that prices the bond at par
        const zSpread = this.computeZSpread(item, baseCurve);

        let oas: number;
        let effectiveDuration: number;
        let effectiveConvexity: number;

        if (hasOption) {
          // Build BDT tree and compute OAS via backward induction
          const treeResult = this.computeOASBinomialTree(item, baseCurve);
          oas = treeResult.oas;
          effectiveDuration = treeResult.effectiveDuration;
          effectiveConvexity = treeResult.effectiveConvexity;
        } else {
          // No optionality: OAS ≈ Z-Spread
          oas = zSpread;
          effectiveDuration = this.computeModifiedDuration(item);
          effectiveConvexity = this.computeConvexity(item);
        }

        const optionCost = zSpread - oas;
        const modifiedDuration = this.computeModifiedDuration(item);

        instruments.push({
          instrumentId: item.id,
          instrumentName: item.name,
          category: item.category,
          balance: item.balance,
          nominalSpread: Math.round(nominalSpread * 10) / 10,
          zSpread: Math.round(zSpread * 10) / 10,
          oas: Math.round(oas * 10) / 10,
          optionCost: Math.round(optionCost * 10) / 10,
          effectiveDuration: Math.round(effectiveDuration * 100) / 100,
          effectiveConvexity: Math.round(effectiveConvexity * 100) / 100,
          modifiedDuration: Math.round(modifiedDuration * 100) / 100,
        });
      }

      const totalBalance = instruments.reduce(
        (s, i) => s + Number(i.balance),
        0,
      );
      const portfolioOAS =
        totalBalance > 0
          ? instruments.reduce((s, i) => s + i.oas * i.balance, 0) /
            totalBalance
          : 0;
      const portfolioEffDuration =
        totalBalance > 0
          ? instruments.reduce(
              (s, i) => s + i.effectiveDuration * i.balance,
              0,
            ) / totalBalance
          : 0;
      const portfolioEffConvexity =
        totalBalance > 0
          ? instruments.reduce(
              (s, i) => s + i.effectiveConvexity * i.balance,
              0,
            ) / totalBalance
          : 0;
      const totalOptionCost = instruments.reduce(
        (s, i) => s + (i.optionCost / 10000) * i.balance,
        0,
      );

      return {
        instruments,
        portfolioOAS: Math.round(portfolioOAS * 10) / 10,
        portfolioEffDuration: Math.round(portfolioEffDuration * 100) / 100,
        portfolioEffConvexity: Math.round(portfolioEffConvexity * 100) / 100,
        totalOptionCost: Math.round(totalOptionCost * 100) / 100,
        totalBalance,
        status: 'ok',
      };
    } catch (error: any) {
      this.logger.error(`Computation failed: ${error.message}`, error.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  // ─── BDT Binomial Tree OAS Computation ────────────────────

  private computeOASBinomialTree(
    item: any,
    baseCurve: TenorRate[],
  ): {
    oas: number;
    effectiveDuration: number;
    effectiveConvexity: number;
  } {
    const periods = Math.min(50, Math.max(10, Math.round(item.duration * 2)));
    const dt = item.duration / periods;
    const coupon = item.rate;
    const par = 100; // normalize to par

    // Build rate tree calibrated to yield curve
    const rateTree = this.buildRateTree(baseCurve, periods, dt);

    // Binary search for OAS
    let lo = -200,
      hi = 800; // bps
    const marketPrice = par; // assume trading at par

    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      const modelPrice = this.priceWithOAS(
        rateTree,
        coupon,
        par,
        periods,
        dt,
        mid,
        item,
      );
      if (Math.abs(modelPrice - marketPrice) < 0.001) break;
      if (modelPrice > marketPrice) lo = mid;
      else hi = mid;
    }
    const oas = (lo + hi) / 2;

    // Effective duration: bump OAS curve ±25bps, reprice
    const priceUp = this.priceWithOAS(
      rateTree,
      coupon,
      par,
      periods,
      dt,
      oas,
      item,
      -25,
    );
    const priceDown = this.priceWithOAS(
      rateTree,
      coupon,
      par,
      periods,
      dt,
      oas,
      item,
      25,
    );
    const effectiveDuration =
      (priceDown - priceUp) / (2 * 0.0025 * marketPrice);

    // Effective convexity
    const effectiveConvexity =
      (priceUp + priceDown - 2 * marketPrice) / (0.0025 * 0.0025 * marketPrice);

    return {
      oas: Math.max(-100, Math.min(500, oas)),
      effectiveDuration: Math.max(0, effectiveDuration),
      effectiveConvexity,
    };
  }

  private buildRateTree(
    curve: TenorRate[],
    periods: number,
    dt: number,
  ): number[][] {
    // Simplified BDT-like tree: lognormal rate at each node
    const tree: number[][] = [];
    const vol = 0.15; // rate volatility (annualized)

    for (let t = 0; t <= periods; t++) {
      const tenor = t * dt;
      const baseRate = Math.max(
        0.001,
        this.interpolateRate(curve, Math.max(0.25, tenor)),
      );
      const nodes: number[] = [];

      for (let j = 0; j <= t; j++) {
        // Up-down factor from center
        const updowns = 2 * j - t;
        const rate = baseRate * Math.exp(vol * Math.sqrt(dt) * updowns);
        nodes.push(Math.max(0.0001, rate));
      }
      tree.push(nodes);
    }

    return tree;
  }

  private priceWithOAS(
    rateTree: number[][],
    coupon: number,
    par: number,
    periods: number,
    dt: number,
    oas: number,
    item: any,
    parallelBump: number = 0,
  ): number {
    const oasDecimal = oas / 10000;
    const bumpDecimal = parallelBump / 10000;
    const hasPrepay = this.hasEmbeddedOption(item);
    const sub = (item.subcategory || '').toLowerCase();
    const isMortgage = sub.includes('mortgage') || sub.includes('residential');

    // Terminal values
    let prices = rateTree[periods].map(() => par);

    // Backward induction
    for (let t = periods - 1; t >= 0; t--) {
      const newPrices: number[] = [];
      for (let j = 0; j <= t; j++) {
        const rate = rateTree[t][j] + oasDecimal + bumpDecimal;
        const cf = coupon * par * dt; // periodic coupon
        const discountedUp = prices[j + 1] / (1 + rate * dt);
        const discountedDown = prices[j] / (1 + rate * dt);
        let nodePrice = 0.5 * (discountedUp + discountedDown) + cf;

        // Exercise decision for callable/prepayable
        if (hasPrepay && t > 0) {
          const exercisePrice = par; // prepay at par
          if (isMortgage) {
            // Prepayment probability based on rate incentive
            const incentive = coupon - rateTree[t][j];
            const preProbability = this.prPrepayProbability(
              incentive,
              t * dt * 12,
            );
            nodePrice =
              nodePrice * (1 - preProbability) + exercisePrice * preProbability;
          } else {
            // Callable bond: exercise if price > call price
            nodePrice = Math.min(nodePrice, exercisePrice);
          }
        }

        newPrices.push(nodePrice);
      }
      prices = newPrices;
    }

    return prices[0];
  }

  private prPrepayProbability(
    rateIncentive: number,
    ageMonths: number,
  ): number {
    // PR-specific CPR (from MP-016 prepayment model)
    const baseCPR = PSA_BASE_CPR;
    const incentiveFactor = 1 / (1 + Math.exp(-10 * (rateIncentive - 0.015)));
    const ageRamp = Math.min(1, ageMonths / 30);
    const monthlyRate =
      (baseCPR * incentiveFactor * ageRamp * PR_LOYALTY_DISCOUNT) / 12;
    return Math.min(0.05, monthlyRate); // cap at 5% per period
  }

  // ─── Z-Spread Calculation ─────────────────────────────────

  private computeZSpread(item: any, curve: TenorRate[]): number {
    const tenor = Math.max(item.duration || 1, 0.25);
    const coupon = item.rate;
    const par = 100;
    const periods = Math.max(1, Math.round(tenor));

    // Binary search for z-spread
    let lo = -100,
      hi = 500;
    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      let pv = 0;
      for (let t = 1; t <= periods; t++) {
        const spotRate = this.interpolateRate(curve, t) + mid / 10000;
        const cf = t === periods ? coupon * par + par : coupon * par;
        pv += cf / Math.pow(1 + spotRate, t);
      }
      if (Math.abs(pv - par) < 0.01) break;
      if (pv > par) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ─── Duration / Convexity Helpers ─────────────────────────

  private computeModifiedDuration(item: any): number {
    const tenor = item.duration || 1;
    const y = item.rate || 0.05;
    // Simplified: Macaulay ≈ duration field, modified = Macaulay / (1+y)
    return tenor / (1 + y);
  }

  private computeConvexity(item: any): number {
    const tenor = item.duration || 1;
    const y = item.rate || 0.05;
    return (tenor * (tenor + 1)) / Math.pow(1 + y, 2);
  }

  private hasEmbeddedOption(item: any): boolean {
    const sub = (item.subcategory || '').toLowerCase();
    return (
      sub.includes('mortgage') ||
      sub.includes('residential') ||
      sub.includes('mbs') ||
      sub.includes('callable') ||
      sub.includes('auto') ||
      sub.includes('consumer')
    );
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
      { tenor: 0.5, rate: 0.0465 },
      { tenor: 1, rate: 0.044 },
      { tenor: 2, rate: 0.042 },
      { tenor: 3, rate: 0.041 },
      { tenor: 5, rate: 0.0405 },
      { tenor: 7, rate: 0.041 },
      { tenor: 10, rate: 0.042 },
      { tenor: 20, rate: 0.0455 },
      { tenor: 30, rate: 0.0465 },
    ];
  }

  // D1 honest shell. Replaces the former getDemoPortfolio() that fabricated a
  // 5-instrument OAS book (FHLB callables, MBS pools, PR muni) for an empty
  // institution.
  private dataUnavailableResult(): OASPortfolioResult {
    return {
      instruments: [],
      portfolioOAS: null,
      portfolioEffDuration: null,
      portfolioEffConvexity: null,
      totalOptionCost: null,
      totalBalance: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('oas.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los instrumentos del balance para calcular el diferencial ajustado por opción (OAS).',
          context: { service: 'oas-calculator' },
        }),
      ],
    };
  }
}
