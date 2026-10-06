import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden012EarlyWarningTrigger: GoldenCase = {
  id: 'golden-012',
  name: 'Early warning system triggers on CAMEL deterioration',
  agentType: 'RISK_MONITOR',
  params: {
    institutionId: 'golden-012',
    scanKind: 'weekly',
  },
  expected: {
    topRiskDomain: 'Asset Quality',
    hasMinDollarQuantification: false,
    healthScoreRange: [30, 55],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 400,
  },
};
