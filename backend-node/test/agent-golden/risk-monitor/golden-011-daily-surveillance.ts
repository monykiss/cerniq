import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden011DailySurveillance: GoldenCase = {
  id: 'golden-011',
  name: 'Daily surveillance scan, declining LCR trend (PR cooperativa)',
  agentType: 'RISK_MONITOR',
  params: {
    institutionId: 'golden-011',
    scanKind: 'daily',
  },
  expected: {
    topRiskDomain: 'Liquidity Risk',
    hasMinDollarQuantification: false,
    healthScoreRange: [55, 80],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 400,
    requiredRegulatoryCodes: ['NCUA 12 CFR 741.12'],
  },
};
