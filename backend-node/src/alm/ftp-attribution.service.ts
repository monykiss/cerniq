import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FTPService } from './ftp.service';

// ─── Types ───────────────────────────────────────────────────

export interface SpreadDecomposition {
  itemId: string;
  name: string;
  category: string;
  subcategory: string;
  balance: number;
  grossRate: number;
  ftpRate: number;
  ftpNet: number; // gross - ftp for assets; ftp - gross for liabilities
  creditSpread: number; // estimated credit risk premium
  optionCost: number; // embedded option cost (prepay/call)
  liquidityPremium: number;
  opCost: number; // operational cost allocation
  economicProfit: number; // ftpNet - creditSpread - optionCost - liquidityPremium - opCost
}

export interface RarocRanking {
  subcategory: string;
  category: string;
  totalBalance: number;
  totalEconomicProfit: number;
  capitalConsumed: number;
  raroc: number; // economic profit / capital consumed
  verdict: 'ACCRETIVE' | 'NEUTRAL' | 'DESTRUCTIVE';
}

export interface FTPAttributionResult {
  decompositions: SpreadDecomposition[];
  rarocRanking: RarocRanking[];
  summary: {
    totalGrossMargin: number;
    totalFTPNet: number;
    totalCreditCost: number;
    totalOptionCost: number;
    totalLiquidityCost: number;
    totalOpCost: number;
    totalEconomicProfit: number;
    portfolioRaroc: number;
  };
}

// ─── Default Cost Parameters ────────────────────────────────

const CREDIT_SPREAD_BY_TYPE: Record<string, number> = {
  cash: 0,
  securities: 0.002,
  consumer_loans: 0.018,
  auto_loans: 0.012,
  residential_mortgage: 0.004,
  commercial_re: 0.008,
  commercial_loans: 0.015,
  credit_cards: 0.035,
  other_assets: 0.005,
};

const OPTION_COST_BY_TYPE: Record<string, number> = {
  residential_mortgage: 0.005, // prepayment option
  auto_loans: 0.002,
  consumer_loans: 0.001,
  commercial_re: 0.003,
  securities: 0.001, // callable bonds
};

const OP_COST_PER_DOLLAR = 0.002; // 20bps operational cost allocation

@Injectable()
export class FTPAttributionService {
  private readonly logger = new Logger(FTPAttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ftp: FTPService,
  ) {}

  async getFullAttribution(
    institutionId: string,
  ): Promise<FTPAttributionResult> {
    const ftpAnalysis = await this.ftp.getFTPAnalysis(institutionId);

    const decompositions: SpreadDecomposition[] = ftpAnalysis.instruments.map(
      (inst) => {
        const sub = inst.subcategory.toLowerCase();
        const isAsset = inst.category === 'asset';

        const ftpNet = isAsset
          ? inst.actualRate - inst.ftpRate
          : inst.ftpRate - inst.actualRate;
        const creditSpread = isAsset
          ? (CREDIT_SPREAD_BY_TYPE[sub] ?? 0.005)
          : 0;
        const optionCost = isAsset ? (OPTION_COST_BY_TYPE[sub] ?? 0) : 0;
        const liquidityPremium = isAsset ? 0.001 : 0; // 10bps liquidity charge on assets
        const opCost = OP_COST_PER_DOLLAR;
        const economicProfit =
          inst.balance *
          (ftpNet - creditSpread - optionCost - liquidityPremium - opCost);

        return {
          itemId: inst.name,
          name: inst.name,
          category: inst.category,
          subcategory: inst.subcategory,
          balance: inst.balance,
          grossRate: inst.actualRate,
          ftpRate: inst.ftpRate,
          ftpNet,
          creditSpread,
          optionCost,
          liquidityPremium,
          opCost,
          economicProfit,
        };
      },
    );

    // Aggregate RAROC by subcategory
    const rarocMap = new Map<
      string,
      { balance: number; profit: number; category: string }
    >();
    for (const d of decompositions) {
      const key = `${d.category}:${d.subcategory}`;
      if (!rarocMap.has(key))
        rarocMap.set(key, { balance: 0, profit: 0, category: d.category });
      const entry = rarocMap.get(key)!;
      entry.balance += Number(d.balance);
      entry.profit += d.economicProfit;
    }

    const rarocRanking: RarocRanking[] = Array.from(rarocMap.entries())
      .map(([key, { balance, profit, category }]) => {
        const capitalConsumed = balance * 0.08; // Basel capital ratio
        const raroc = capitalConsumed > 0 ? profit / capitalConsumed : 0;
        return {
          subcategory: key.split(':')[1],
          category,
          totalBalance: balance,
          totalEconomicProfit: Math.round(profit * 1000) / 1000,
          capitalConsumed: Math.round(capitalConsumed * 10) / 10,
          raroc: Math.round(raroc * 10000) / 10000,
          verdict:
            raroc > 0.12
              ? ('ACCRETIVE' as const)
              : raroc >= 0.05
                ? ('NEUTRAL' as const)
                : ('DESTRUCTIVE' as const),
        };
      })
      .sort((a, b) => b.raroc - a.raroc);

    const totalProfit = decompositions.reduce(
      (s, d) => s + d.economicProfit,
      0,
    );
    const totalBalance = decompositions.reduce(
      (s, d) => s + Number(d.balance),
      0,
    );

    return {
      decompositions,
      rarocRanking,
      summary: {
        totalGrossMargin: ftpAnalysis.summary.netFTPMargin,
        totalFTPNet: decompositions.reduce(
          (s, d) => s + d.balance * d.ftpNet,
          0,
        ),
        totalCreditCost: decompositions.reduce(
          (s, d) => s + d.balance * d.creditSpread,
          0,
        ),
        totalOptionCost: decompositions.reduce(
          (s, d) => s + d.balance * d.optionCost,
          0,
        ),
        totalLiquidityCost: decompositions.reduce(
          (s, d) => s + d.balance * d.liquidityPremium,
          0,
        ),
        totalOpCost: decompositions.reduce(
          (s, d) => s + d.balance * d.opCost,
          0,
        ),
        totalEconomicProfit: Math.round(totalProfit * 100) / 100,
        portfolioRaroc:
          totalBalance > 0
            ? Math.round((totalProfit / (totalBalance * 0.08)) * 10000) / 10000
            : 0,
      },
    };
  }
}
