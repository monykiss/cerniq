import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden025LiquidityWeakness: GoldenCase = {
  id: 'golden-025',
  name: 'Liquidity weakness — LCR below 100%, examiner focus area',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-025',
    examType: 'annual',
    lcrPct: 85,
  },
  expected: {
    topRiskDomain: 'Liquidity Risk',
    hasMinDollarQuantification: false,
    healthScoreRange: [30, 55],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
  },
};
