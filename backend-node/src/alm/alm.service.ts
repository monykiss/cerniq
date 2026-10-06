import { Injectable, Logger } from '@nestjs/common';
import { validateBalanceSheet } from './alm-errors';
import {
  BalanceSheetDto,
  InstrumentDto,
  HQLADto,
  LCRRequestDto,
  InstrumentDetail,
  DurationGapResult,
  NIIScenario,
  NIIResult,
  EVEScenario,
  EVEResult,
  LCRResult,
  BPVInstrument,
  BPVResult,
  FullAnalysisResult,
} from './alm.dto';

/** Default parallel rate shocks in basis points */
const DEFAULT_SHOCKS_BPS = [-300, -200, -100, -50, 0, 50, 100, 200, 300];

@Injectable()
export class AlmService {
  private readonly logger = new Logger(AlmService.name);

  // ─── Duration Gap Analysis ──────────────────────────────────────

  /**
   * Compute duration gap for a balance sheet.
   *
   * **Macaulay Duration** for a fixed-rate bond:
   *   D = Σ(t × PV(CF_t)) / Price
   * where PV(CF_t) = CF_t / (1 + y)^t, y = annual yield, t in years.
   *
   * For a **floating-rate** instrument the duration approximates the
   * time to the next repricing date (in years).
   *
   * **Modified Duration** = Macaulay Duration / (1 + y)
   *
   * **Duration Gap** = D_A − (L / A) × D_L
   * A positive gap means assets are more sensitive to rate changes than
   * liabilities ⇒ rising rates hurt equity.
   */
  durationGapAnalysis(balanceSheet: BalanceSheetDto): DurationGapResult {
    validateBalanceSheet(balanceSheet, 'Duration Gap');

    const assetDetails = balanceSheet.assets.map((i) =>
      this.instrumentDetail(i),
    );
    const liabilityDetails = balanceSheet.liabilities.map((i) =>
      this.instrumentDetail(i),
    );

    const totalAssets = assetDetails.reduce((s, d) => s + Number(d.amount), 0);
    const totalLiabilities = liabilityDetails.reduce(
      (s, d) => s + Number(d.amount),
      0,
    );

    /** Weighted-average Macaulay duration (weights = notional share) */
    const assetDuration = this.weightedDuration(assetDetails, totalAssets);
    const liabilityDuration = this.weightedDuration(
      liabilityDetails,
      totalLiabilities,
    );

    const leverageRatio = totalAssets > 0 ? totalLiabilities / totalAssets : 0;
    const durationGap = assetDuration - leverageRatio * liabilityDuration;
    const leverageAdjustedGap = durationGap; // same by definition

    const interpretation = this.interpretDurationGap(durationGap);

    return {
      assetDuration: round(assetDuration, 4),
      liabilityDuration: round(liabilityDuration, 4),
      durationGap: round(durationGap, 4),
      leverageAdjustedGap: round(leverageAdjustedGap, 4),
      totalAssets,
      totalLiabilities,
      interpretation,
      assetDetails,
      liabilityDetails,
    };
  }

  // ─── NII Simulation ─────────────────────────────────────────────

  /**
   * Net Interest Income simulation under parallel rate shocks.
   *
   * **Base NII** = Σ(asset_i.amount × asset_i.rate) − Σ(liab_j.amount × liab_j.rate)
   *
   * Under a shock of Δr:
   * - Fixed-rate instruments: income/cost unchanged for the projection horizon.
   * - Floating-rate instruments: the rate adjusts by Δr at repricing.
   *   If repricingFrequencyMonths = m, the fraction of the year that
   *   reprices within a 12-month horizon = min(floor(12/m), 1) repricings.
   *   We assume the full notional reprices at each reset for simplicity,
   *   so the new annualised interest = amount × (rate + Δr).
   *
   * The change from base NII is reported in absolute dollars and as a
   * percentage, with a risk classification.
   */
  niiSimulation(
    balanceSheet: BalanceSheetDto,
    rateShocksBps: number[] = DEFAULT_SHOCKS_BPS,
  ): NIIResult {
    validateBalanceSheet(balanceSheet, 'NII Simulation');

    const baseAssetIncome = balanceSheet.assets.reduce(
      (s, a) => s + a.amount * a.rate,
      0,
    );
    const baseLiabilityCost = balanceSheet.liabilities.reduce(
      (s, l) => s + l.amount * l.rate,
      0,
    );
    const baseNII = baseAssetIncome - baseLiabilityCost;

    const scenarios: NIIScenario[] = rateShocksBps.map((bps) => {
      const deltaR = bps / 10_000; // convert bps → decimal

      const shockedAssetIncome = balanceSheet.assets.reduce(
        (s, a) => s + this.shockedIncome(a, deltaR),
        0,
      );
      const shockedLiabilityCost = balanceSheet.liabilities.reduce(
        (s, l) => s + this.shockedIncome(l, deltaR),
        0,
      );
      const nii = shockedAssetIncome - shockedLiabilityCost;
      const change = nii - baseNII;
      const changePct = baseNII !== 0 ? change / Math.abs(baseNII) : 0;

      return {
        shockBps: bps,
        nii: round(nii, 2),
        change: round(change, 2),
        changePct: round(changePct, 6),
        riskLevel: this.niiRiskLevel(changePct),
      };
    });

    return {
      baseNII: round(baseNII, 2),
      assetIncome: round(baseAssetIncome, 2),
      liabilityCost: round(baseLiabilityCost, 2),
      scenarios,
    };
  }

  // ─── EVE Analysis ───────────────────────────────────────────────

  /**
   * Economic Value of Equity under parallel rate shocks.
   *
   * EVE = PV(asset cash flows) − PV(liability cash flows)
   *
   * Present value of an instrument's cash flows (assuming annual coupons
   * and par repayment at maturity):
   *   PV = Σ_{t=1..T} C / (1+y)^t  +  P / (1+y)^T
   * where C = coupon = amount × rate, P = principal = amount, y = discount rate.
   *
   * For floating-rate instruments, after the next repricing the coupon resets
   * to (rate + Δr). We model this by computing the PV of the floating leg
   * as: PV ≈ amount (par, since floating resets to market), adjusted by the
   * time to next repricing.
   */
  eveAnalysis(
    balanceSheet: BalanceSheetDto,
    rateShocksBps: number[] = DEFAULT_SHOCKS_BPS,
  ): EVEResult {
    validateBalanceSheet(balanceSheet, 'EVE Analysis');

    const baseAssetPV = balanceSheet.assets.reduce(
      (s, a) => s + this.presentValue(a, 0),
      0,
    );
    const baseLiabilityPV = balanceSheet.liabilities.reduce(
      (s, l) => s + this.presentValue(l, 0),
      0,
    );
    const baseEVE = baseAssetPV - baseLiabilityPV;

    const scenarios: EVEScenario[] = rateShocksBps.map((bps) => {
      const deltaR = bps / 10_000;

      const shockedAssetPV = balanceSheet.assets.reduce(
        (s, a) => s + this.presentValue(a, deltaR),
        0,
      );
      const shockedLiabilityPV = balanceSheet.liabilities.reduce(
        (s, l) => s + this.presentValue(l, deltaR),
        0,
      );
      const eve = shockedAssetPV - shockedLiabilityPV;
      const change = eve - baseEVE;
      const changePct = baseEVE !== 0 ? change / Math.abs(baseEVE) : 0;

      return {
        shockBps: bps,
        eve: round(eve, 2),
        change: round(change, 2),
        changePct: round(changePct, 6),
      };
    });

    return {
      baseEVE: round(baseEVE, 2),
      scenarios,
    };
  }

  // ─── Liquidity Coverage Ratio ───────────────────────────────────

  /**
   * Compute the Basel III Liquidity Coverage Ratio.
   *
   * LCR = HQLA / Total Net Cash Outflows ≥ 100 %
   *
   * HQLA is tiered with haircuts:
   * - **Level 1** (cash, central-bank reserves, sovereigns): 0 % haircut
   * - **Level 2A** (agency MBS, covered bonds): 15 % haircut
   * - **Level 2B** (corporate bonds, equities): 25 % haircut (was noted as 50% in some Basel texts but user spec says 25%)
   *
   * **Cap**: Total Level 2 assets (2A + 2B after haircuts) ≤ 40 % of total HQLA.
   *
   * Thresholds: ≥ 100 % compliant, 90–100 % warning, < 90 % breach.
   */
  liquidityCoverageRatio(input: LCRRequestDto): LCRResult {
    const { hqla, totalNetOutflows } = input;
    return this.computeLCR(hqla, totalNetOutflows);
  }

  // ─── Basis Point Value ──────────────────────────────────────────

  /**
   * BPV (DV01) — the change in market value for a 1-basis-point (0.01 %)
   * parallel shift in rates.
   *
   * BPV_i = amount_i × modifiedDuration_i × 0.0001
   *
   * Net BPV = Σ asset BPVs − Σ liability BPVs.
   * Positive net BPV means the institution loses value when rates rise.
   */
  basisPointValue(balanceSheet: BalanceSheetDto): BPVResult {
    validateBalanceSheet(balanceSheet, 'BPV');

    const assetBPVs: BPVInstrument[] = balanceSheet.assets.map((i) => {
      const detail = this.instrumentDetail(i);
      return {
        name: i.name,
        amount: i.amount,
        bpv: round(detail.bpv, 2),
        modifiedDuration: round(detail.modifiedDuration, 4),
      };
    });

    const liabilityBPVs: BPVInstrument[] = balanceSheet.liabilities.map((i) => {
      const detail = this.instrumentDetail(i);
      return {
        name: i.name,
        amount: i.amount,
        bpv: round(detail.bpv, 2),
        modifiedDuration: round(detail.modifiedDuration, 4),
      };
    });

    const totalAssetBPV = round(
      assetBPVs.reduce((s, b) => s + b.bpv, 0),
      2,
    );
    const totalLiabilityBPV = round(
      liabilityBPVs.reduce((s, b) => s + b.bpv, 0),
      2,
    );
    const netBPV = round(totalAssetBPV - totalLiabilityBPV, 2);

    const interpretation =
      netBPV > 0
        ? `Net BPV is +$${netBPV.toLocaleString()}. A 1bp rise in rates reduces equity by ~$${netBPV.toLocaleString()}.`
        : netBPV < 0
          ? `Net BPV is -$${Math.abs(netBPV).toLocaleString()}. A 1bp rise in rates increases equity by ~$${Math.abs(netBPV).toLocaleString()}.`
          : 'Net BPV is zero — the balance sheet is duration-matched.';

    return {
      totalAssetBPV,
      totalLiabilityBPV,
      netBPV,
      assetBPVs,
      liabilityBPVs,
      interpretation,
    };
  }

  // ─── Demo Balance Sheet ─────────────────────────────────────────

  /**
   * Returns a representative $500M community bank balance sheet.
   *
   * Assets ($500M):
   * - Commercial RE Loans (fixed, 7yr, 5.5%)      $150M
   * - C&I Floating Loans (float, 5yr, SOFR+2.5%)  $120M — reprices quarterly
   * - 10yr Treasury Securities (fixed, 10yr, 4.2%)  $80M
   * - Auto Loans (fixed, 5yr, 6.8%)                 $90M
   * - Overnight Fed Funds (float, 0yr, 5.3%)        $60M — reprices daily
   *
   * Liabilities ($450M):
   * - Core Deposits / Savings (fixed, 1yr, 1.5%)   $200M
   * - 3yr Term CDs (fixed, 3yr, 4.0%)               $80M
   * - FHLB Advances (float, 2yr, 4.8%)              $70M — reprices semi-annually
   * - Money Market Accounts (float, 0yr, 3.5%)      $60M — reprices monthly
   * - Subordinated Debt (fixed, 10yr, 5.5%)          $40M
   *
   * Equity: $50M
   */
  getDemoBalanceSheet(): BalanceSheetDto {
    return {
      assets: [
        {
          name: 'Commercial RE Loans',
          amount: 150_000_000,
          rate: 0.055,
          maturityYears: 7,
          isFloating: false,
        },
        {
          name: 'C&I Floating Loans',
          amount: 120_000_000,
          rate: 0.075, // SOFR (~5.0%) + 2.5% spread
          maturityYears: 5,
          isFloating: true,
          repricingFrequencyMonths: 3,
        },
        {
          name: '10yr Treasury Securities',
          amount: 80_000_000,
          rate: 0.042,
          maturityYears: 10,
          isFloating: false,
        },
        {
          name: 'Auto Loans',
          amount: 90_000_000,
          rate: 0.068,
          maturityYears: 5,
          isFloating: false,
        },
        {
          name: 'Overnight Fed Funds',
          amount: 60_000_000,
          rate: 0.053,
          maturityYears: 0,
          isFloating: true,
          repricingFrequencyMonths: 0,
        },
      ],
      liabilities: [
        {
          name: 'Core Deposits / Savings',
          amount: 200_000_000,
          rate: 0.015,
          maturityYears: 1,
          isFloating: false,
        },
        {
          name: '3yr Term CDs',
          amount: 80_000_000,
          rate: 0.04,
          maturityYears: 3,
          isFloating: false,
        },
        {
          name: 'FHLB Advances',
          amount: 70_000_000,
          rate: 0.048,
          maturityYears: 2,
          isFloating: true,
          repricingFrequencyMonths: 6,
        },
        {
          name: 'Money Market Accounts',
          amount: 60_000_000,
          rate: 0.035,
          maturityYears: 0,
          isFloating: true,
          repricingFrequencyMonths: 1,
        },
        {
          name: 'Subordinated Debt',
          amount: 40_000_000,
          rate: 0.055,
          maturityYears: 10,
          isFloating: false,
        },
      ],
      equity: 50_000_000,
    };
  }

  // ─── Full Analysis ──────────────────────────────────────────────

  /**
   * Run all ALM analyses in one call.
   * If LCR data is not provided, a rough LCR is derived from the balance sheet.
   */
  fullAnalysis(
    balanceSheet: BalanceSheetDto,
    rateShocksBps?: number[],
    lcrInput?: LCRRequestDto,
  ): FullAnalysisResult {
    const shocks = rateShocksBps ?? DEFAULT_SHOCKS_BPS;

    const durationGap = this.durationGapAnalysis(balanceSheet);
    const niiSimulation = this.niiSimulation(balanceSheet, shocks);
    const eve = this.eveAnalysis(balanceSheet, shocks);
    const bpv = this.basisPointValue(balanceSheet);

    let lcr: LCRResult | null = null;
    if (lcrInput) {
      lcr = this.liquidityCoverageRatio(lcrInput);
    } else {
      lcr = this.deriveLCRFromBalanceSheet(balanceSheet);
    }

    return {
      summary: {
        totalAssets: durationGap.totalAssets,
        totalLiabilities: durationGap.totalLiabilities,
        equity: balanceSheet.equity,
        timestamp: new Date().toISOString(),
      },
      durationGap,
      niiSimulation,
      eve,
      bpv,
      lcr,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Private helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Compute Macaulay Duration, Modified Duration, and BPV for a single instrument.
   *
   * For fixed-rate bonds with annual coupons:
   *   Macaulay Duration = Σ(t × PV(CF_t)) / Σ(PV(CF_t))
   *
   * For floating-rate:
   *   Duration ≈ time to next repricing (in years).
   *   If repricingFrequencyMonths = 0 (overnight), duration = 1/365.
   */
  private instrumentDetail(inst: InstrumentDto): InstrumentDetail {
    let macaulayDuration: number;

    if (inst.isFloating) {
      // Floating-rate: duration approximates time to next repricing
      const repricingMonths = inst.repricingFrequencyMonths ?? 0;
      macaulayDuration = repricingMonths > 0 ? repricingMonths / 12 : 1 / 365;
    } else if (inst.maturityYears === 0) {
      // Overnight / demand — negligible duration
      macaulayDuration = 1 / 365;
    } else {
      macaulayDuration = this.macaulayDuration(inst.rate, inst.maturityYears);
    }

    const modifiedDuration = macaulayDuration / (1 + inst.rate);
    const bpv = inst.amount * modifiedDuration * 0.0001;

    return {
      name: inst.name,
      amount: inst.amount,
      rate: inst.rate,
      maturityYears: inst.maturityYears,
      isFloating: inst.isFloating,
      macaulayDuration: round(macaulayDuration, 4),
      modifiedDuration: round(modifiedDuration, 4),
      bpv: round(bpv, 2),
    };
  }

  /**
   * Macaulay Duration for a par bond paying annual coupons.
   *
   * D = [ Σ_{t=1}^{T} t × c / (1+y)^t  +  T × 1 / (1+y)^T ] / Price
   * where c = coupon rate, y = yield (= c for par bond), Price = 1 (par).
   *
   * Since we assume the bond is priced at par (coupon rate = yield),
   * Price = 1 and we divide by 1.
   */
  private macaulayDuration(couponRate: number, maturityYears: number): number {
    if (maturityYears <= 0) return 0;
    if (couponRate === 0) return maturityYears; // zero-coupon bond

    const y = couponRate;
    let weightedSum = 0;
    let priceSum = 0;

    for (let t = 1; t <= maturityYears; t++) {
      const discount = Math.pow(1 + y, t);
      const couponPV = couponRate / discount;
      weightedSum += t * couponPV;
      priceSum += couponPV;
    }

    // Principal repayment at maturity
    const principalPV = 1 / Math.pow(1 + y, maturityYears);
    weightedSum += maturityYears * principalPV;
    priceSum += principalPV;

    return priceSum > 0 ? weightedSum / priceSum : 0;
  }

  /**
   * Weighted-average duration across a set of instruments.
   * Weight = instrument notional / total notional.
   */
  private weightedDuration(details: InstrumentDetail[], total: number): number {
    if (total === 0) return 0;
    return details.reduce(
      (sum, d) => sum + (d.amount / total) * d.macaulayDuration,
      0,
    );
  }

  /**
   * NII for a single instrument under a rate shock.
   *
   * Fixed-rate: income = amount × rate (unchanged).
   * Floating-rate: income = amount × (rate + beta × deltaR).
   *
   * Deposit repricing betas reflect the empirical pass-through of
   * market rate changes to deposit rates. Cooperativas and community
   * banks typically see partial pass-through on member deposits:
   *   - Demand/savings deposits: beta = 0.40 (sticky, slow to reprice)
   *   - Time deposits/CDs:      beta = 0.80 (competitive, faster reprice)
   *   - Borrowed funds (FHLB):   beta = 1.00 (market-rate indexed)
   *   - Loans (asset side):      beta = 1.00 (contractual repricing)
   */
  private shockedIncome(inst: InstrumentDto, deltaR: number): number {
    if (inst.isFloating) {
      const beta = this.getRepricingBeta(inst);
      const shockedRate = Math.max(inst.rate + beta * deltaR, 0);
      return inst.amount * shockedRate;
    }
    return inst.amount * inst.rate;
  }

  /**
   * Determine the repricing beta for a floating-rate instrument.
   * Uses name-based heuristics to classify deposit types.
   */
  private getRepricingBeta(inst: InstrumentDto): number {
    const name = inst.name.toLowerCase();

    // Liability-side deposit betas (partial pass-through)
    if (
      name.includes('demand') ||
      name.includes('checking') ||
      name.includes('corriente') ||
      name.includes('savings') ||
      name.includes('ahorro')
    ) {
      return 0.4;
    }
    if (
      name.includes('time') ||
      name.includes('cd') ||
      name.includes('certificate') ||
      name.includes('certificado') ||
      name.includes('plazo')
    ) {
      return 0.8;
    }

    // Everything else (loans, borrowings, FHLB) = full pass-through
    return 1.0;
  }

  /**
   * Present value of an instrument's cash flows under a rate shock.
   *
   * Fixed-rate (annual coupon, par at maturity):
   *   PV = Σ_{t=1}^{T} C / (1 + y + Δr)^t  +  P / (1 + y + Δr)^T
   *
   * Floating-rate: PV ≈ par (the bond reprices to par at each reset).
   * For simplicity the PV of a floater is approximately the notional
   * discounted by the time to next repricing.
   */
  private presentValue(inst: InstrumentDto, deltaR: number): number {
    if (inst.isFloating) {
      // Floater reprices to par at next reset
      const repricingMonths = inst.repricingFrequencyMonths ?? 0;
      const timeToReset = repricingMonths > 0 ? repricingMonths / 12 : 1 / 365;
      const discountRate = Math.max(inst.rate + deltaR, 0.0001);
      return inst.amount / Math.pow(1 + discountRate, timeToReset);
    }

    if (inst.maturityYears === 0) {
      return inst.amount; // overnight — already at par
    }

    const y = Math.max(inst.rate + deltaR, 0.0001); // floor to avoid division issues
    const coupon = inst.amount * inst.rate;
    let pv = 0;

    for (let t = 1; t <= inst.maturityYears; t++) {
      pv += coupon / Math.pow(1 + y, t);
    }
    pv += inst.amount / Math.pow(1 + y, inst.maturityYears);

    return pv;
  }

  /**
   * Compute LCR from HQLA components and net outflows.
   *
   * Haircuts per Basel III:
   * - Level 1: 0% → contributes 100%
   * - Level 2A: 15% → contributes 85%
   * - Level 2B: 25% → contributes 75% (per user spec)
   *
   * Cap: Level 2 total (after haircuts) ≤ 40% of total HQLA.
   */
  private computeLCR(hqla: HQLADto, totalNetOutflows: number): LCRResult {
    const level1 = hqla.level1;
    const level2aAdjusted = hqla.level2a * 0.85;
    const level2bAdjusted = hqla.level2b * 0.75;

    const level2Total = level2aAdjusted + level2bAdjusted;

    // Cap: Level 2 ≤ 40% of total HQLA
    // Total HQLA = Level 1 + min(Level 2, 2/3 × Level 1)
    // Because if Level2 ≤ 40% of Total, and Total = L1 + L2,
    // then L2 ≤ 0.4(L1 + L2) → L2 ≤ (2/3)L1
    const level2Cap = (2 / 3) * level1;
    const level2Applied = Math.min(level2Total, level2Cap);

    const hqlaTotal = round(level1 + level2Applied, 2);
    const lcr =
      totalNetOutflows > 0 ? round((hqlaTotal / totalNetOutflows) * 100, 2) : 0;

    const threshold = 100;
    let status: 'compliant' | 'warning' | 'breach';
    if (lcr >= threshold) {
      status = 'compliant';
    } else if (lcr >= 90) {
      status = 'warning';
    } else {
      status = 'breach';
    }

    return {
      lcr,
      hqlaTotal,
      hqlaBreakdown: {
        level1,
        level2a: hqla.level2a,
        level2aAdjusted: round(level2aAdjusted, 2),
        level2b: hqla.level2b,
        level2bAdjusted: round(level2bAdjusted, 2),
        level2Cap: round(level2Cap, 2),
        level2Applied: round(level2Applied, 2),
      },
      totalNetOutflows,
      threshold,
      status,
    };
  }

  /**
   * Derive a rough LCR from the balance sheet when explicit HQLA data
   * is not provided.
   *
   * Heuristic:
   * - Level 1: overnight / demand assets (maturity = 0, floating)
   * - Level 2A: treasury securities (fixed, maturity ≥ 5yr)
   * - Level 2B: 0 (conservative)
   * - Net outflows: 10% of total liabilities (30-day stress)
   */
  private deriveLCRFromBalanceSheet(bs: BalanceSheetDto): LCRResult {
    let level1 = 0;
    let level2a = 0;

    for (const asset of bs.assets) {
      if (asset.isFloating && asset.maturityYears === 0) {
        level1 += Number(asset.amount); // cash-like
      } else if (
        !asset.isFloating &&
        asset.maturityYears >= 5 &&
        asset.rate < 0.05
      ) {
        level2a += Number(asset.amount); // treasury-like
      }
    }

    const totalLiabilities = bs.liabilities.reduce(
      (s, l) => s + Number(l.amount),
      0,
    );
    const estimatedOutflows = totalLiabilities * 0.1; // 10% stress outflow

    return this.computeLCR({ level1, level2a, level2b: 0 }, estimatedOutflows);
  }

  /** Interpret a duration gap for a human-readable summary. */
  private interpretDurationGap(gap: number): string {
    const absGap = Math.abs(gap);
    if (absGap < 0.5) {
      return `Duration gap of ${round(gap, 2)} years — well matched. Low interest rate risk.`;
    }
    if (absGap < 2) {
      return gap > 0
        ? `Duration gap of +${round(gap, 2)} years — moderately asset-sensitive. Rising rates will reduce equity value.`
        : `Duration gap of ${round(gap, 2)} years — moderately liability-sensitive. Falling rates will reduce equity value.`;
    }
    return gap > 0
      ? `Duration gap of +${round(gap, 2)} years — significantly asset-sensitive. Large exposure to rising rates.`
      : `Duration gap of ${round(gap, 2)} years — significantly liability-sensitive. Large exposure to falling rates.`;
  }

  /** Classify NII change percentage into risk levels. */
  private niiRiskLevel(
    changePct: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    const abs = Math.abs(changePct);
    if (abs < 0.05) return 'low'; // < 5%
    if (abs < 0.1) return 'medium'; // 5–10%
    if (abs < 0.2) return 'high'; // 10–20%
    return 'critical'; // ≥ 20%
  }
}

/** Round to n decimal places. */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
