import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden002LiquidityStress: GoldenCase = {
  id: 'golden-002',
  name: 'Liquidity stress, capital erosion (PR cooperativa, post-outflow)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-002',
  },
  expected: {
    topRiskDomain: 'Liquidity Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [30, 55],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['COSSEC Carta Circular 2021-02'],
  },
};
