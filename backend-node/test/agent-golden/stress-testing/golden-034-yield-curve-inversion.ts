import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden034YieldCurveInversion: GoldenCase = {
  id: 'golden-034',
  name: 'Yield curve inversion — short rates above long rates, NIM compression',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-034',
    scenarios: ['curve_inversion'],
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [40, 65],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
  },
};
