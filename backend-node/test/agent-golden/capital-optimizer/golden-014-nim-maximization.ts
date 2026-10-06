import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden014NimMaximization: GoldenCase = {
  id: 'golden-014',
  name: 'NIM maximization within COSSEC hard constraints',
  agentType: 'CAPITAL_OPTIMIZER',
  params: {
    institutionId: 'golden-014',
    targetNimImprovementBps: 15,
  },
  expected: {
    topRiskDomain: 'Capital Allocation',
    hasMinDollarQuantification: true,
    healthScoreRange: [60, 85],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 500,
    requiredRegulatoryCodes: ['12 CFR 702'],
  },
};
