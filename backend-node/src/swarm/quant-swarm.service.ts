import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// Runs all 8 core quant models simultaneously via Promise.allSettled
// Never crashes if 1 model fails — returns partial results with fallbacks

export interface QuantSwarmResult {
  institutionId: string;
  healthScore: number;
  completedModels: string[];
  failedModels: string[];
  computeTimeMs: number;
  confidence: SwarmConfidence;
  rateShock: any;
  liquidity: any;
  cecl: any;
  concentration: any;
  ftp: any;
  peers: any;
  camel: any;
  climate: any;
  earlyWarning: any;
  capitalAdequacy: any;
  repricingGap: any;
  depositBeta: any;
}

export interface SwarmConfidence {
  score: number;
  label: 'HIGH' | 'MEDIUM' | 'LOW';
  missingCritical: string[];
}

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  rateShock: 25,
  liquidity: 20,
  cecl: 10,
  concentration: 8,
  ftp: 5,
  peers: 5,
  camel: 5,
  climate: 2,
  earlyWarning: 10,
  capitalAdequacy: 5,
  repricingGap: 3,
  depositBeta: 2,
};

const CRITICAL_MODELS = [
  'rateShock',
  'liquidity',
  'earlyWarning',
  'capitalAdequacy',
];

@Injectable()
export class QuantSwarmService {
  private readonly logger = new Logger(QuantSwarmService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runFullSwarm(
    institutionId: string,
    services: {
      yieldCurve: any;
      liquidity: any;
      cecl: any;
      concentration: any;
      ftp: any;
      peers: any;
      camel: any;
      climate: any;
      earlyWarning: any;
      capitalAdequacy: any;
      repricingGap: any;
      depositBeta: any;
      advisor: any;
    },
  ): Promise<QuantSwarmResult> {
    const start = Date.now();

    const [
      rateShock,
      liquidity,
      cecl,
      concentration,
      ftp,
      peers,
      camel,
      climate,
      earlyWarning,
      capitalAdequacy,
      repricingGap,
      depositBeta,
    ] = await Promise.allSettled([
      services.yieldCurve.getYieldCurveAnalysis(institutionId),
      services.liquidity.getAdvancedLiquidity(institutionId),
      services.cecl.getCECLAnalysis(institutionId),
      services.concentration.getConcentrationAnalysis(institutionId),
      services.ftp.getFTPAnalysis(institutionId),
      services.peers.getPeerAnalytics(institutionId),
      services.camel.scoreInstitution(institutionId),
      services.climate.computeClimateRisk(institutionId),
      services.earlyWarning.computeEWS(institutionId),
      services.capitalAdequacy.calculate(institutionId),
      services.repricingGap.getRepricingGap(institutionId),
      services.depositBeta.getDepositBetas(institutionId),
    ]);

    const extract = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled' ? r.value : null;
    const modelNames = [
      'rateShock',
      'liquidity',
      'cecl',
      'concentration',
      'ftp',
      'peers',
      'camel',
      'climate',
      'earlyWarning',
      'capitalAdequacy',
      'repricingGap',
      'depositBeta',
    ];
    const allResults = [
      rateShock,
      liquidity,
      cecl,
      concentration,
      ftp,
      peers,
      camel,
      climate,
      earlyWarning,
      capitalAdequacy,
      repricingGap,
      depositBeta,
    ];

    const completed = modelNames.filter(
      (_, i) => allResults[i].status === 'fulfilled',
    );
    const failed = modelNames.filter(
      (_, i) => allResults[i].status === 'rejected',
    );

    if (failed.length > 0) {
      this.logger.warn(
        `Swarm: ${failed.length} models failed: ${failed.join(', ')}`,
      );
    }

    const healthScore = await services.advisor
      .computeHealthScore(institutionId)
      .catch(() => ({ overall: 50 }));

    const confidence = computeSwarmConfidence(completed, failed);

    return {
      institutionId,
      healthScore: healthScore.overall ?? 50,
      completedModels: completed,
      failedModels: failed,
      computeTimeMs: Date.now() - start,
      confidence,
      rateShock: extract(rateShock),
      liquidity: extract(liquidity),
      cecl: extract(cecl),
      concentration: extract(concentration),
      ftp: extract(ftp),
      peers: extract(peers),
      camel: extract(camel),
      climate: extract(climate),
      earlyWarning: extract(earlyWarning),
      capitalAdequacy: extract(capitalAdequacy),
      repricingGap: extract(repricingGap),
      depositBeta: extract(depositBeta),
    };
  }
}

function computeSwarmConfidence(
  completed: string[],
  failed: string[],
): SwarmConfidence {
  const totalWeight = Object.values(CONFIDENCE_WEIGHTS).reduce(
    (a, b) => a + b,
    0,
  );
  const achievedWeight = completed.reduce(
    (sum, model) => sum + (CONFIDENCE_WEIGHTS[model] ?? 0),
    0,
  );
  const score = Math.round((achievedWeight / totalWeight) * 100);
  const label: SwarmConfidence['label'] =
    score >= 90 ? 'HIGH' : score >= 70 ? 'MEDIUM' : 'LOW';
  const missingCritical = failed.filter((m) => CRITICAL_MODELS.includes(m));

  return { score, label, missingCritical };
}
