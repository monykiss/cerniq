import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StressV2Service } from './stress-v2.service';

export interface RobustOptResult {
  strategy: 'minimax-regret';
  bestAllocation: Array<{
    subcategory: string;
    currentBalance: number;
    suggestedDelta: number;
  }>;
  scenarioPerformance: Array<{ scenario: string; nii: number; regret: number }>;
  maxRegret: number;
  baselineNII: number;
  robustNII: number;
  narrativeEs: string;
  narrativeEn: string;
}

@Injectable()
export class RobustOptimizerService {
  private readonly logger = new Logger(RobustOptimizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stressV2: StressV2Service,
  ) {}

  async optimize(
    institutionId: string,
    aggressiveness: 'conservative' | 'moderate' | 'aggressive' = 'moderate',
  ): Promise<RobustOptResult> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const scenarios = this.stressV2.getPresetScenarios();
    const totalAssets =
      items
        .filter((i: any) => i.category === 'asset')
        .reduce((s: number, i: any) => s + Number(i.balance), 0) || 445;

    const maxMovePct = { conservative: 0.03, moderate: 0.06, aggressive: 0.1 }[
      aggressiveness
    ];
    const maxMoveUSD = totalAssets * maxMovePct;

    // Generate 15 candidate perturbations
    const perturbations = this.generatePerturbations(items, maxMoveUSD);

    // Performance matrix: [perturbation][scenario] = cumulative NII over 9 quarters
    const perfMatrix: number[][] = [];
    for (const pert of perturbations) {
      const row: number[] = [];
      for (const scenario of scenarios) {
        const adjustedItems = this.applyPerturbation(items, pert);
        const baseNII =
          adjustedItems
            .filter((i) => i.category === 'asset')
            .reduce((s, i) => s + i.balance * i.rate, 0) -
          adjustedItems
            .filter((i) => i.category === 'liability')
            .reduce((s, i) => s + i.balance * i.rate, 0);
        // Simplified: adjust NII by rate path average
        const avgRateShock =
          scenario.ratePathBps.reduce((a, b) => a + b, 0) /
          scenario.ratePathBps.length /
          10000;
        const stressedNII =
          baseNII * (1 + avgRateShock * 3) * (1 + scenario.gdpDelta);
        row.push((stressedNII * 9) / 4); // annualized 9Q
      }
      perfMatrix.push(row);
    }

    // Best achievable per scenario
    const bestPerScenario = scenarios.map((_, s) =>
      Math.max(...perfMatrix.map((row) => row[s])),
    );

    // Max regret per perturbation
    const maxRegrets = perfMatrix.map((row) =>
      Math.max(...row.map((nii, s) => bestPerScenario[s] - nii)),
    );

    // Minimax: pick perturbation with minimum max-regret
    const bestIdx = maxRegrets.indexOf(Math.min(...maxRegrets));
    const baselineNII = perfMatrix[0][0]; // status quo under base scenario

    return {
      strategy: 'minimax-regret',
      bestAllocation: perturbations[bestIdx]
        .map((p) => ({
          subcategory: p.subcategory,
          currentBalance: p.currentBalance,
          suggestedDelta: p.delta,
        }))
        .filter((p) => Math.abs(p.suggestedDelta) > 0.1),
      scenarioPerformance: scenarios.map((s, i) => ({
        scenario: s.name,
        nii: +perfMatrix[bestIdx][i].toFixed(2),
        regret: +(bestPerScenario[i] - perfMatrix[bestIdx][i]).toFixed(2),
      })),
      maxRegret: +maxRegrets[bestIdx].toFixed(2),
      baselineNII: +baselineNII.toFixed(2),
      robustNII: +perfMatrix[bestIdx][0].toFixed(2),
      narrativeEs: `Optimización robusta (minimax-regret): la asignación sugerida minimiza la pérdida máxima bajo los 3 escenarios DFAST. Regret máximo: $${maxRegrets[bestIdx].toFixed(1)}M.`,
      narrativeEn: `Robust optimization (minimax-regret): suggested allocation minimizes worst-case loss across all 3 DFAST scenarios. Max regret: $${maxRegrets[bestIdx].toFixed(1)}M.`,
    };
  }

  private generatePerturbations(
    items: any[],
    maxMove: number,
  ): Array<
    Array<{ subcategory: string; currentBalance: number; delta: number }>
  > {
    const bySub = new Map<string, number>();
    for (const item of items) {
      bySub.set(
        item.subcategory,
        (bySub.get(item.subcategory) ?? 0) + Number(item.balance),
      );
    }

    const subs = Array.from(bySub.entries());
    const perturbations: Array<
      Array<{ subcategory: string; currentBalance: number; delta: number }>
    > = [];

    // Status quo
    perturbations.push(
      subs.map(([sub, bal]) => ({
        subcategory: sub,
        currentBalance: bal,
        delta: 0,
      })),
    );

    // Generate shifts between pairs
    for (let i = 0; i < Math.min(subs.length, 5); i++) {
      for (let j = i + 1; j < Math.min(subs.length, 5); j++) {
        const move = Math.min(maxMove, subs[i][1] * 0.3, subs[j][1] * 0.3);
        if (move < 1) continue;
        perturbations.push(
          subs.map(([sub, bal]) => ({
            subcategory: sub,
            currentBalance: bal,
            delta: sub === subs[i][0] ? -move : sub === subs[j][0] ? move : 0,
          })),
        );
        perturbations.push(
          subs.map(([sub, bal]) => ({
            subcategory: sub,
            currentBalance: bal,
            delta: sub === subs[i][0] ? move : sub === subs[j][0] ? -move : 0,
          })),
        );
      }
    }

    return perturbations.slice(0, 15);
  }

  private applyPerturbation(
    items: any[],
    perturbation: Array<{ subcategory: string; delta: number }>,
  ): any[] {
    const deltaMap = new Map(perturbation.map((p) => [p.subcategory, p.delta]));
    return items.map((i) => ({
      ...i,
      balance:
        i.balance +
        (deltaMap.get(i.subcategory) ?? 0) /
          items.filter((x) => x.subcategory === i.subcategory).length,
    }));
  }
}
