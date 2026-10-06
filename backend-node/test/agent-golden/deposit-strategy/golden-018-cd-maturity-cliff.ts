import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden018CdMaturityCliff: GoldenCase = {
  id: 'golden-018',
  name: 'Deposit strategy: $40M CD maturity cliff in 90 days, rising rate env',
  agentType: 'DEPOSIT_STRATEGY',
  params: {
    institutionId: 'golden-018',
    horizonMonths: 12,
  },
  expected: {
    topRiskDomain: 'Liquidity Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [50, 75],
    hasRegulatoryReference: false,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
  },
};
