import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden005CapitalAdequacy: GoldenCase = {
  id: 'golden-005',
  name: 'Capital adequacy concern (net worth 6.8%, near COSSEC minimum)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-005',
  },
  expected: {
    topRiskDomain: 'Capital Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [35, 60],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['12 CFR 702'],
  },
};
