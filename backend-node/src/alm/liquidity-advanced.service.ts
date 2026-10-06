import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Types ───────────────────────────────────────────────────

export interface NSFRResult {
  nsfr: number; // percentage
  asf: number; // available stable funding ($M)
  rsf: number; // required stable funding ($M)
  status: 'compliant' | 'warning' | 'breach';
  asfBreakdown: Array<{
    category: string;
    balance: number;
    factor: number;
    weighted: number;
  }>;
  rsfBreakdown: Array<{
    category: string;
    balance: number;
    factor: number;
    weighted: number;
  }>;
}

export interface DepositFlightSimulation {
  tiers: DepositTierResult[];
  survivalHorizonMonths: number;
  monthlyProjections: Array<{
    month: number;
    totalDeposits: number;
    cumulativeOutflow: number;
    hqlaRemaining: number;
    liquidityRatio: number;
  }>;
  worstCaseLoss: number;
  expectedLoss: number;
}

interface DepositTierResult {
  tierName: string;
  balance: number;
  insuredPct: number;
  monthlyFlightRate: number;
  month6Loss: number;
  month12Loss: number;
}

export interface HQLABreakdown {
  level1: number;
  level2a: number;
  level2aAdjusted: number;
  level2b: number;
  level2bAdjusted: number;
  level2Cap: number;
  level2Applied: number;
}

export interface LCRDetail {
  lcr: number;
  hqlaTotal: number;
  hqlaBreakdown: HQLABreakdown;
  totalNetOutflows: number;
  status: 'compliant' | 'warning' | 'breach';
}

export interface AdvancedLiquidityResult {
  lcr: number;
  lcrDetail: LCRDetail;
  nsfr: NSFRResult;
  depositFlight: DepositFlightSimulation;
}

@Injectable()
export class LiquidityAdvancedService {
  private readonly logger = new Logger(LiquidityAdvancedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAdvancedLiquidity(
    institutionId: string,
  ): Promise<AdvancedLiquidityResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const liquidityPos = await this.prisma.liquidityPosition.findFirst({
      where: { institutionId },
      orderBy: { date: 'desc' },
    });
    const depositTiers = await this.prisma.depositTier.findMany({
      where: { institutionId },
    });

    const nsfr = this.calculateNSFR(items);
    const lcrDetail = this.calculateLCR(items);
    const tiers =
      depositTiers.length > 0 ? depositTiers : this.getDefaultTiers(items);
    const totalHQLA =
      (liquidityPos?.hqlaLevel1 ?? 0) + (liquidityPos?.hqlaLevel2 ?? 0);
    const depositFlight = this.simulateDepositFlight(tiers, totalHQLA);

    return {
      lcr: lcrDetail.lcr,
      lcrDetail,
      nsfr,
      depositFlight,
    };
  }

  // ─── LCR Calculation ───────────────────────────────────────

  calculateLCR(items: any[]): LCRDetail {
    const assets = items.filter((i: any) => i.category === 'asset');
    const liabilities = items.filter((i: any) => i.category === 'liability');

    // HQLA: cash + government securities + high-grade bonds
    const cash = assets
      .filter((i: any) =>
        ['cash', 'cash_equivalents'].includes(i.subcategory?.toLowerCase()),
      )
      .reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const govSecurities = assets
      .filter((i: any) =>
        ['government_securities', 'treasury'].includes(
          i.subcategory?.toLowerCase(),
        ),
      )
      .reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const corpBonds = assets
      .filter((i: any) =>
        ['corporate_bonds', 'investment_securities'].includes(
          i.subcategory?.toLowerCase(),
        ),
      )
      .reduce((s: number, i: any) => s + (i.balance || 0), 0);

    const level1 = cash + govSecurities;
    const level2a = corpBonds * 0.85; // 15% haircut
    const hqlaTotal = level1 + level2a;

    // Net cash outflows: short-term liabilities with runoff assumptions
    const shortTermLiabilities = liabilities
      .filter((i: any) => (i.maturityYears ?? 0) <= 1)
      .reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const totalNetOutflows = shortTermLiabilities * 0.25; // 25% stress outflow rate

    const lcr =
      totalNetOutflows > 0
        ? +((hqlaTotal / totalNetOutflows) * 100).toFixed(1)
        : 999;

    return {
      lcr,
      hqlaTotal,
      hqlaBreakdown: {
        level1,
        level2a,
        level2aAdjusted: level2a,
        level2b: 0,
        level2bAdjusted: 0,
        level2Cap: level1 * 0.6667, // Basel III: Level 2 ≤ 2/3 of Level 1
        level2Applied: Math.min(level2a, level1 * 0.6667),
      },
      totalNetOutflows,
      status: lcr >= 100 ? 'compliant' : lcr >= 80 ? 'warning' : 'breach',
    };
  }

  // ─── NSFR Calculation ──────────────────────────────────────

  calculateNSFR(items: any[]): NSFRResult {
    const asfBreakdown: NSFRResult['asfBreakdown'] = [];
    const rsfBreakdown: NSFRResult['rsfBreakdown'] = [];

    // ASF: Liabilities + Equity
    const liabilities = items.filter((i) => i.category === 'liability');
    for (const item of liabilities) {
      const factor = this.getASFFactor(item);
      asfBreakdown.push({
        category: item.name || item.subcategory,
        balance: item.balance,
        factor,
        weighted: item.balance * factor,
      });
    }

    // Add equity estimate (total assets - total liabilities)
    const totalAssets = items
      .filter((i) => i.category === 'asset')
      .reduce((s, i) => s + Number(i.balance), 0);
    const totalLiabilities = liabilities.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );
    const equity = Math.max(totalAssets - totalLiabilities, 0);
    if (equity > 0) {
      asfBreakdown.push({
        category: 'Equity',
        balance: equity,
        factor: 1.0,
        weighted: equity,
      });
    }

    // RSF: Assets
    const assets = items.filter((i) => i.category === 'asset');
    for (const item of assets) {
      const factor = this.getRSFFactor(item);
      rsfBreakdown.push({
        category: item.name || item.subcategory,
        balance: item.balance,
        factor,
        weighted: item.balance * factor,
      });
    }

    const asf = asfBreakdown.reduce((s, r) => s + r.weighted, 0);
    const rsf = rsfBreakdown.reduce((s, r) => s + r.weighted, 0);
    const nsfr = rsf > 0 ? (asf / rsf) * 100 : 999;

    return {
      nsfr,
      asf,
      rsf,
      status: nsfr >= 100 ? 'compliant' : nsfr >= 90 ? 'warning' : 'breach',
      asfBreakdown,
      rsfBreakdown,
    };
  }

  // ─── Deposit Flight Simulation ─────────────────────────────

  simulateDepositFlight(
    tiers: any[],
    totalHQLA: number,
  ): DepositFlightSimulation {
    const tierResults: DepositTierResult[] = tiers.map((t) => {
      const tierName = t.tierName ?? t.tier_name ?? 'unknown';
      const balance = t.balance;
      const insuredPct = t.insuredPct ?? t.insured_pct ?? 0.5;
      const monthlyFlightRate = t.flightRate ?? t.flight_rate ?? 0.05;

      const month6Loss = balance * (1 - Math.pow(1 - monthlyFlightRate, 6));
      const month12Loss = balance * (1 - Math.pow(1 - monthlyFlightRate, 12));

      return {
        tierName,
        balance,
        insuredPct,
        monthlyFlightRate,
        month6Loss,
        month12Loss,
      };
    });

    // Monthly projections
    const horizon = 12;
    const monthlyProjections: DepositFlightSimulation['monthlyProjections'] =
      [];
    let hqla =
      totalHQLA ||
      tierResults.reduce((s, t) => s + Number(t.balance), 0) * 0.15;
    let totalDeposits = tierResults.reduce((s, t) => s + Number(t.balance), 0);
    let cumulativeOutflow = 0;
    let survivalHorizonMonths = horizon;

    for (let m = 1; m <= horizon; m++) {
      let monthOutflow = 0;
      for (const tier of tierResults) {
        monthOutflow +=
          tier.balance *
          tier.monthlyFlightRate *
          Math.pow(1 - tier.monthlyFlightRate, m - 1);
      }
      cumulativeOutflow += monthOutflow;
      totalDeposits -= monthOutflow;
      hqla = Math.max(0, hqla - monthOutflow * 0.5); // HQLA depletes as we fund outflows

      const liquidityRatio =
        totalDeposits > 0 ? (hqla / totalDeposits) * 100 : 0;

      monthlyProjections.push({
        month: m,
        totalDeposits: Math.max(totalDeposits, 0),
        cumulativeOutflow,
        hqlaRemaining: hqla,
        liquidityRatio,
      });

      if (hqla <= 0 && survivalHorizonMonths === horizon) {
        survivalHorizonMonths = m;
      }
    }

    return {
      tiers: tierResults,
      survivalHorizonMonths,
      monthlyProjections,
      worstCaseLoss: tierResults.reduce((s, t) => s + t.month12Loss, 0),
      expectedLoss: tierResults.reduce((s, t) => s + t.month6Loss, 0) * 0.3, // 30% probability
    };
  }

  // ─── Private Helpers ───────────────────────────────────────

  private getASFFactor(item: any): number {
    const sub = (item.subcategory || '').toLowerCase();
    if (
      sub.includes('demand') ||
      sub.includes('savings') ||
      sub.includes('ahorro')
    )
      return 0.95;
    if (sub.includes('time') || sub.includes('cd') || sub.includes('plazo')) {
      return (item.duration || 1) > 1 ? 1.0 : 0.5;
    }
    if (sub.includes('borrowing') || sub.includes('fhlb')) {
      return (item.duration || 0) > 1 ? 1.0 : 0.0;
    }
    return 0.5;
  }

  private getRSFFactor(item: any): number {
    const sub = (item.subcategory || '').toLowerCase();
    if (sub.includes('cash') || sub.includes('reserves')) return 0.0;
    if (sub.includes('treasury') || sub.includes('government')) return 0.05;
    if (sub.includes('agency') || sub.includes('mbs')) return 0.15;
    if (sub.includes('securities') || sub.includes('bonds')) return 0.5;
    if (sub.includes('mortgage') || sub.includes('residential')) return 0.65;
    if (sub.includes('commercial') && sub.includes('re')) return 0.85;
    if (
      sub.includes('loan') ||
      sub.includes('consumer') ||
      sub.includes('auto')
    ) {
      return (item.duration || 1) > 1 ? 0.65 : 0.5;
    }
    return 1.0;
  }

  private getDefaultTiers(items: any[]): any[] {
    const liabilities = items.filter((i) => i.category === 'liability');
    const totalDeposits = liabilities.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );

    return [
      {
        tierName: 'Insured Core',
        balance: totalDeposits * 0.5,
        insuredPct: 0.95,
        flightRate: 0.02,
      },
      {
        tierName: 'Uninsured',
        balance: totalDeposits * 0.25,
        insuredPct: 0.1,
        flightRate: 0.08,
      },
      {
        tierName: 'Brokered',
        balance: totalDeposits * 0.15,
        insuredPct: 0.5,
        flightRate: 0.15,
      },
      {
        tierName: 'Large Single Depositor',
        balance: totalDeposits * 0.1,
        insuredPct: 0.05,
        flightRate: 0.2,
      },
    ];
  }
}
