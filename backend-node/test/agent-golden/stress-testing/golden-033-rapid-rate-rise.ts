import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden033RapidRateRise: GoldenCase = {
  id: 'golden-033',
  name: 'Rapid rate rise 400bp in 6 months — NII squeeze on short-funded institution',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-033',
    scenarios: ['rapid_rise_400'],
    horizonMonths: 6,
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [30, 55],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
  },
};
