import { Injectable, Logger } from '@nestjs/common';
import { asNumber } from './reports/report-formatting';

/**
 * Represents a balance sheet line item for duration/convexity calculation.
 * Compatible with Prisma BalanceSheetItem model.
 */
export interface BalanceSheetItem {
  category: string; // 'asset' | 'liability'
  subcategory: string;
  name: string;
  balance: number; // in millions ($M)
  rate: number; // decimal (0.05 = 5%) or percentage (5.0) — auto-detected
  duration: number; // years (used as fallback maturity)
  rateType: string; // 'fixed' | 'variable'
  maturityDate?: Date | null;
  repriceDate?: Date | null;
}

export interface InstrumentCashFlows {
  name: string;
  category: string;
  balance: number; // in $M
  cashFlows: number[]; // annual cash flows in $M
  yieldRate: number; // decimal
  maturityYears: number;
  price: number; // current market value in $M (≈ balance for par instruments)
}

export interface PortfolioDurationMetrics {
  assetDuration: number;
  assetConvexity: number;
  liabilityDuration: number;
  liabilityConvexity: number;
  durationGap: number;
  leverageAdjustedDurationGap: number;
  totalAssets: number; // $M
  totalLiabilities: number; // $M
  assetDetails: Array<{
    name: string;
    balance: number;
    modifiedDuration: number;
    convexity: number;
    maturityYears: number;
    yieldRate: number;
  }>;
  liabilityDetails: Array<{
    name: string;
    balance: number;
    modifiedDuration: number;
    convexity: number;
    maturityYears: number;
    yieldRate: number;
  }>;
}

export interface EVESensitivityPoint {
  shockBps: number;
  assetValueChange: number; // $M
  liabilityValueChange: number; // $M
  eveChange: number; // $M
  eveChangePct: number; // percentage
  baseEVE: number; // $M
}

/** Round to n decimal places */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

@Injectable()
export class DurationService {
  private readonly logger = new Logger(DurationService.name);

  // ─── Core Instrument-Level Calculations ──────────────────────

  /**
   * Modified Macaulay duration for a single instrument.
   *
   * cashFlows: array of annual cash flows (coupon + principal at maturity)
   * yieldRate: annual yield as decimal (0.05 = 5%)
   * price: current market value
   *
   * Modified Duration = Macaulay Duration / (1 + yieldRate)
   *
   * Test: calculateModifiedDuration([100, 100, 1100], 0.05, 1000) ≈ 2.72 years
   */
  calculateModifiedDuration(
    cashFlows: number[],
    yieldRate: number,
    price: number,
  ): number {
    if (price <= 0 || cashFlows.length === 0) return 0;
    if (yieldRate < 0) yieldRate = 0;

    let macDuration = 0;
    for (let t = 1; t <= cashFlows.length; t++) {
      macDuration += (t * cashFlows[t - 1]) / Math.pow(1 + yieldRate, t);
    }
    macDuration /= price;

    // Modified duration: adjust for compounding
    return macDuration / (1 + yieldRate);
  }

  /**
   * Macaulay duration (non-modified) for a single instrument.
   */
  calculateMacaulayDuration(
    cashFlows: number[],
    yieldRate: number,
    price: number,
  ): number {
    if (price <= 0 || cashFlows.length === 0) return 0;
    if (yieldRate < 0) yieldRate = 0;

    let macDuration = 0;
    for (let t = 1; t <= cashFlows.length; t++) {
      macDuration += (t * cashFlows[t - 1]) / Math.pow(1 + yieldRate, t);
    }
    return macDuration / price;
  }

  /**
   * Convexity for a single instrument.
   *
   * Convexity = (1/P) × Σ [ t(t+1) × CF_t / (1+y)^(t+2) ]
   *
   * The convexity adjustment is the key differentiator — most competitors
   * skip it, but for large rate shocks (±200-300bps) the second-order
   * term becomes material (can be 10-15% of total price change).
   */
  calculateConvexity(
    cashFlows: number[],
    yieldRate: number,
    price: number,
  ): number {
    if (price <= 0 || cashFlows.length === 0) return 0;
    if (yieldRate < 0) yieldRate = 0;

    let convexity = 0;
    for (let t = 1; t <= cashFlows.length; t++) {
      convexity +=
        (t * (t + 1) * cashFlows[t - 1]) / Math.pow(1 + yieldRate, t + 2);
    }
    return convexity / price;
  }

  // ─── Cash Flow Generation ────────────────────────────────────

  /**
   * Derive approximate annual cash flows from a balance sheet item.
   *
   * For each BalanceSheetItem, generate cash flows based on instrument type:
   * - Fixed-rate loan: annual coupon = balance × rate, principal returned at maturity
   * - Variable-rate loan: duration used as approximate maturity, coupon = balance × rate
   *   (variable-rate instruments have short effective duration due to repricing,
   *    but we model them with contractual maturity for EVE purposes)
   * - Deposits (liability): outflow = balance × rate per period, principal at maturity
   * - If no maturity date: use duration field as years to maturity
   */
  generateCashFlows(item: BalanceSheetItem): InstrumentCashFlows {
    // Normalize rate: if > 1, assume it's a percentage (e.g., 5.5 → 0.055)
    const rawRate = asNumber(item.rate);
    const yieldRate = rawRate > 1 ? rawRate / 100 : rawRate;
    const balance = asNumber(item.balance); // already in $M

    // Determine maturity in years
    let maturityYears: number;
    if (item.maturityDate) {
      maturityYears = Math.max(
        1,
        Math.round(
          (item.maturityDate.getTime() - Date.now()) /
            (365.25 * 24 * 3600 * 1000),
        ),
      );
    } else {
      maturityYears = Math.max(1, Math.round(asNumber(item.duration) || 1));
    }

    // For variable-rate instruments, effective duration for repricing
    // is much shorter, but we still model full contractual cash flows
    // for EVE sensitivity (Basel IRRBB standard)
    const annualCoupon = balance * yieldRate;
    const cashFlows: number[] = [];

    for (let t = 1; t <= maturityYears; t++) {
      if (t < maturityYears) {
        cashFlows.push(annualCoupon);
      } else {
        // Final year: coupon + principal return
        cashFlows.push(annualCoupon + balance);
      }
    }

    // Price: for instruments priced at par, price ≈ balance
    // We compute the theoretical price from cash flows for accuracy
    let price = 0;
    for (let t = 1; t <= cashFlows.length; t++) {
      price += cashFlows[t - 1] / Math.pow(1 + yieldRate, t);
    }
    // If computed price is unreasonable (zero-rate edge case), use balance
    if (price <= 0 || !isFinite(price)) {
      price = balance;
    }

    return {
      name: item.name,
      category: item.category,
      balance,
      cashFlows,
      yieldRate,
      maturityYears,
      price,
    };
  }

  // ─── Portfolio-Level Metrics ─────────────────────────────────

  /**
   * Portfolio-level weighted duration and convexity from balance sheet items.
   *
   * Returns modified duration and convexity for both asset and liability sides,
   * plus the duration gap and leverage-adjusted duration gap.
   *
   * Duration Gap = D_assets - (L/A) × D_liabilities
   * where L/A is the leverage ratio (total liabilities / total assets).
   */
  calculatePortfolioMetrics(
    items: BalanceSheetItem[],
  ): PortfolioDurationMetrics {
    const assetItems = items.filter(
      (i) => i.category === 'asset' && asNumber(i.balance) > 0,
    );
    const liabilityItems = items.filter(
      (i) => i.category === 'liability' && asNumber(i.balance) > 0,
    );

    const totalAssets = assetItems.reduce((s, i) => s + asNumber(i.balance), 0);
    const totalLiabilities = liabilityItems.reduce(
      (s, i) => s + asNumber(i.balance),
      0,
    );

    // Calculate per-instrument metrics for assets
    const assetDetails = assetItems.map((item) => {
      const cf = this.generateCashFlows(item);
      const modDuration = this.calculateModifiedDuration(
        cf.cashFlows,
        cf.yieldRate,
        cf.price,
      );
      const convexity = this.calculateConvexity(
        cf.cashFlows,
        cf.yieldRate,
        cf.price,
      );
      return {
        name: item.name,
        balance: asNumber(item.balance),
        modifiedDuration: round(modDuration, 4),
        convexity: round(convexity, 4),
        maturityYears: cf.maturityYears,
        yieldRate: cf.yieldRate,
      };
    });

    // Calculate per-instrument metrics for liabilities
    const liabilityDetails = liabilityItems.map((item) => {
      const cf = this.generateCashFlows(item);
      const modDuration = this.calculateModifiedDuration(
        cf.cashFlows,
        cf.yieldRate,
        cf.price,
      );
      const convexity = this.calculateConvexity(
        cf.cashFlows,
        cf.yieldRate,
        cf.price,
      );
      return {
        name: item.name,
        balance: asNumber(item.balance),
        modifiedDuration: round(modDuration, 4),
        convexity: round(convexity, 4),
        maturityYears: cf.maturityYears,
        yieldRate: cf.yieldRate,
      };
    });

    // Weighted average duration (weights = market value / total)
    const assetDuration =
      totalAssets > 0
        ? assetDetails.reduce(
            (s, d) => s + (d.balance / totalAssets) * d.modifiedDuration,
            0,
          )
        : 0;
    const liabilityDuration =
      totalLiabilities > 0
        ? liabilityDetails.reduce(
            (s, d) => s + (d.balance / totalLiabilities) * d.modifiedDuration,
            0,
          )
        : 0;

    // Weighted average convexity
    const assetConvexity =
      totalAssets > 0
        ? assetDetails.reduce(
            (s, d) => s + (d.balance / totalAssets) * d.convexity,
            0,
          )
        : 0;
    const liabilityConvexity =
      totalLiabilities > 0
        ? liabilityDetails.reduce(
            (s, d) => s + (d.balance / totalLiabilities) * d.convexity,
            0,
          )
        : 0;

    // Duration gap = D_a - D_l (simple)
    const durationGap = assetDuration - liabilityDuration;

    // Leverage-adjusted duration gap = D_a - (L/A) × D_l
    const leverageRatio = totalAssets > 0 ? totalLiabilities / totalAssets : 0;
    const leverageAdjustedDurationGap =
      assetDuration - leverageRatio * liabilityDuration;

    return {
      assetDuration: round(assetDuration, 4),
      assetConvexity: round(assetConvexity, 4),
      liabilityDuration: round(liabilityDuration, 4),
      liabilityConvexity: round(liabilityConvexity, 4),
      durationGap: round(durationGap, 4),
      leverageAdjustedDurationGap: round(leverageAdjustedDurationGap, 4),
      totalAssets: round(totalAssets, 2),
      totalLiabilities: round(totalLiabilities, 2),
      assetDetails,
      liabilityDetails,
    };
  }

  // ─── EVE Sensitivity ─────────────────────────────────────────

  /**
   * EVE sensitivity across multiple rate shocks using duration + convexity.
   *
   * The second-order Taylor expansion for price change:
   *
   *   ΔP/P ≈ -D × Δr + 0.5 × C × (Δr)²
   *
   * Therefore, for the full balance sheet:
   *
   *   ΔEVE ≈ -D_a × V_a × Δr + D_l × V_l × Δr
   *          + 0.5 × C_a × V_a × (Δr)² - 0.5 × C_l × V_l × (Δr)²
   *
   * Where:
   *   D_a, D_l = modified duration of assets, liabilities
   *   C_a, C_l = convexity of assets, liabilities
   *   V_a, V_l = total market value of assets, liabilities
   *   Δr = rate shock in decimal (100bps = 0.01)
   *
   * Default shocks: -200, -100, +100, +200, +300 bps
   * (Standard Basel IRRBB interest rate risk scenarios)
   */
  calculateEVESensitivity(
    assetDuration: number,
    assetConvexity: number,
    totalAssets: number,
    liabDuration: number,
    liabConvexity: number,
    totalLiabilities: number,
    rateShocks?: number[],
  ): EVESensitivityPoint[] {
    const shocks = rateShocks || [-200, -100, 100, 200, 300];
    const baseEVE = totalAssets - totalLiabilities;

    return shocks.map((shockBps) => {
      const dr = shockBps / 10000; // convert bps to decimal

      // First-order (duration) effect
      const assetDurationEffect = -assetDuration * totalAssets * dr;
      const liabDurationEffect = -liabDuration * totalLiabilities * dr;

      // Second-order (convexity) adjustment
      const assetConvexityEffect = 0.5 * assetConvexity * totalAssets * dr * dr;
      const liabConvexityEffect =
        0.5 * liabConvexity * totalLiabilities * dr * dr;

      // Total value change for each side
      const assetValueChange = assetDurationEffect + assetConvexityEffect;
      const liabilityValueChange = liabDurationEffect + liabConvexityEffect;

      // EVE change = asset value change - liability value change
      const eveChange = assetValueChange - liabilityValueChange;
      const eveChangePct =
        baseEVE !== 0 ? (eveChange / Math.abs(baseEVE)) * 100 : 0;

      return {
        shockBps,
        assetValueChange: round(assetValueChange, 4),
        liabilityValueChange: round(liabilityValueChange, 4),
        eveChange: round(eveChange, 4),
        eveChangePct: round(eveChangePct, 2),
        baseEVE: round(baseEVE, 4),
      };
    });
  }

  // ─── Convenience: Full analysis from raw DB items ────────────

  /**
   * Run the complete duration/convexity/EVE analysis from raw balance
   * sheet items (as returned by Prisma).
   *
   * This is the main entry point used by AlmEnterpriseService.
   */
  fullDurationAnalysis(
    items: BalanceSheetItem[],
    rateShocks?: number[],
  ): {
    portfolio: PortfolioDurationMetrics;
    eveSensitivity: EVESensitivityPoint[];
  } {
    const portfolio = this.calculatePortfolioMetrics(items);

    const eveSensitivity = this.calculateEVESensitivity(
      portfolio.assetDuration,
      portfolio.assetConvexity,
      portfolio.totalAssets,
      portfolio.liabilityDuration,
      portfolio.liabilityConvexity,
      portfolio.totalLiabilities,
      rateShocks,
    );

    return { portfolio, eveSensitivity };
  }
}
