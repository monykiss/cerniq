import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden031HurricaneLiquidityDrain: GoldenCase = {
  id: 'golden-031',
  name: 'Category 4 hurricane — deposit runoff + insurance claims surge',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-031',
    scenarios: ['hurricane_cat4'],
    depositRunoffPct: 15,
  },
  expected: {
    topRiskDomain: 'Liquidity Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [20, 50],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['COSSEC'],
  },
};
