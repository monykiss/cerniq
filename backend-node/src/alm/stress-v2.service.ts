import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface DFASTScenario {
  id: string;
  name: string;
  nameEs: string;
  ratePathBps: number[]; // 9 quarters
  gdpDelta: number;
  unemploymentDelta: number;
  reDelta: number;
  hurricaneProb: number;
  isPreset: boolean;
}

export interface StressV2Quarter {
  quarter: string;
  nii: number;
  eve: number;
  lcr: number;
  nsfr: number;
  nwr: number;
  el: number;
}

export interface StressV2Result {
  scenarioId: string;
  scenarioName: string;
  quarters: StressV2Quarter[];
  minNWR: number;
  minLCR: number;
  cumulativeNIILoss: number;
  isCapitalAdequate: boolean;
  narrativeEs: string;
  narrativeEn: string;
}

const DFAST_PRESETS: DFASTScenario[] = [
  {
    id: 'dfast-severe',
    name: 'Severe Adverse',
    nameEs: 'Severamente Adverso',
    ratePathBps: [75, 75, 100, 50, 0, -25, -50, -50, -25],
    gdpDelta: -0.035,
    unemploymentDelta: 0.04,
    reDelta: -0.15,
    hurricaneProb: 0,
    isPreset: true,
  },
  {
    id: 'dfast-hurricane',
    name: 'Hurricane Scenario',
    nameEs: 'Escenario Huracán',
    ratePathBps: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    gdpDelta: -0.08,
    unemploymentDelta: 0.06,
    reDelta: -0.3,
    hurricaneProb: 1.0,
    isPreset: true,
  },
  {
    id: 'dfast-stagflation',
    name: 'Stagflation',
    nameEs: 'Estanflación',
    ratePathBps: [100, 100, 75, 50, 25, 25, 0, 0, -25],
    gdpDelta: -0.015,
    unemploymentDelta: 0.03,
    reDelta: -0.05,
    hurricaneProb: 0,
    isPreset: true,
  },
];

@Injectable()
export class StressV2Service {
  private readonly logger = new Logger(StressV2Service.name);

  constructor(private readonly prisma: PrismaService) {}

  getPresetScenarios(): DFASTScenario[] {
    return DFAST_PRESETS;
  }

  async runStressTest(
    institutionId: string,
    scenario: DFASTScenario,
  ): Promise<StressV2Result> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const totalAssets =
      items
        .filter((i: any) => i.category === 'asset')
        .reduce((s: number, i: any) => s + Number(i.balance), 0) || 445;
    const totalLiabilities =
      items
        .filter((i: any) => i.category === 'liability')
        .reduce((s: number, i: any) => s + Number(i.balance), 0) || 385;
    const equity = totalAssets - totalLiabilities;
    const baseNII =
      items
        .filter((i: any) => i.category === 'asset')
        .reduce((s: number, i: any) => s + i.balance * i.rate, 0) -
      items
        .filter((i: any) => i.category === 'liability')
        .reduce((s: number, i: any) => s + i.balance * i.rate, 0);

    const quarters: StressV2Quarter[] = [];
    let cumRateShock = 0;
    let runningAssets = totalAssets;
    let runningEquity = equity;

    const now = new Date();
    for (let q = 0; q < 9; q++) {
      cumRateShock += (scenario.ratePathBps[q] ?? 0) / 10000;
      const qDate = new Date(
        now.getFullYear(),
        now.getMonth() + (q + 1) * 3,
        1,
      );
      const qLabel = `Q${Math.ceil((qDate.getMonth() + 1) / 3)} ${qDate.getFullYear()}`;

      // Growth impacted by GDP shock
      const growthFactor = 1 + (0.03 + scenario.gdpDelta) / 4;
      runningAssets *= growthFactor;

      // NII: rate shock affects repricing + credit loss from macro overlay
      const rateImpactOnNII = (baseNII / 4) * (1 + cumRateShock * 3);
      const creditLoss =
        runningAssets *
        0.005 *
        (1 + scenario.unemploymentDelta * 5) *
        (1 + scenario.hurricaneProb * 2);
      const quarterNII = rateImpactOnNII - creditLoss;

      runningEquity += quarterNII;
      const nwr = runningAssets > 0 ? (runningEquity / runningAssets) * 100 : 0;
      const lcr = 115 + cumRateShock * 500 - scenario.gdpDelta * 200;
      const nsfr = 108 + cumRateShock * 200;
      const el = creditLoss;

      quarters.push({
        quarter: qLabel,
        nii: +quarterNII.toFixed(2),
        eve: +runningEquity.toFixed(1),
        lcr: +Math.max(50, Math.min(200, lcr)).toFixed(1),
        nsfr: +Math.max(50, Math.min(180, nsfr)).toFixed(1),
        nwr: +Math.max(0, nwr).toFixed(1),
        el: +el.toFixed(2),
      });
    }

    const minNWR = Math.min(...quarters.map((q) => q.nwr));
    const minLCR = Math.min(...quarters.map((q) => q.lcr));
    const cumNIILoss = quarters.reduce(
      (s, q) => s + Math.min(0, q.nii - baseNII / 4),
      0,
    );

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      quarters,
      minNWR: +minNWR.toFixed(1),
      minLCR: +minLCR.toFixed(1),
      cumulativeNIILoss: +cumNIILoss.toFixed(2),
      isCapitalAdequate: minNWR >= 7,
      narrativeEs: `Bajo el escenario "${scenario.nameEs}", el NWR mínimo es ${minNWR.toFixed(1)}% (${minNWR >= 7 ? 'bien capitalizada' : 'SUBCAPITALIZADA'}). LCR mínimo: ${minLCR.toFixed(0)}%. Pérdida NII acumulada: $${Math.abs(cumNIILoss).toFixed(1)}M.`,
      narrativeEn: `Under "${scenario.name}" scenario, minimum NWR is ${minNWR.toFixed(1)}% (${minNWR >= 7 ? 'well-capitalized' : 'UNDERCAPITALIZED'}). Minimum LCR: ${minLCR.toFixed(0)}%. Cumulative NII loss: $${Math.abs(cumNIILoss).toFixed(1)}M.`,
    };
  }

  async runAllPresets(institutionId: string): Promise<StressV2Result[]> {
    return Promise.all(
      DFAST_PRESETS.map((s) => this.runStressTest(institutionId, s)),
    );
  }
}
