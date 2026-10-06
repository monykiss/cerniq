import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden015CossecFilingDeadline: GoldenCase = {
  id: 'golden-015',
  name: 'COSSEC quarterly filing with 15-day deadline, incomplete data',
  agentType: 'REGULATORY_COMPLIANCE',
  params: {
    institutionId: 'golden-015',
    focusRegulator: 'COSSEC',
  },
  expected: {
    topRiskDomain: 'Regulatory Compliance',
    hasMinDollarQuantification: false,
    healthScoreRange: [35, 65],
    hasRegulatoryReference: true,
    toolsCalledMin: 3,
    bilingualRequired: true,
    maxWords: 500,
    requiredRegulatoryCodes: ['Ley 255-2002'],
  },
};
