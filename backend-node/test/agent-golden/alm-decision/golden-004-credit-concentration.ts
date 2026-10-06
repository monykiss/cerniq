import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden004CreditConcentration: GoldenCase = {
  id: 'golden-004',
  name: 'Credit concentration risk (auto-loan sector >20%, CECL coverage low)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-004',
  },
  expected: {
    topRiskDomain: 'Credit Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [40, 65],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['12 CFR 723'],
  },
};
