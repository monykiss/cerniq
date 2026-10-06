import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden003HealthyBaseline: GoldenCase = {
  id: 'golden-003',
  name: 'Healthy baseline (all metrics within policy, stable trends)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-003',
  },
  expected: {
    topRiskDomain: undefined,
    hasMinDollarQuantification: true,
    healthScoreRange: [75, 95],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
  },
};
