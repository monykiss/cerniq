import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden020BoardPacketBilingual: GoldenCase = {
  id: 'golden-020',
  name: 'Board packet narrative: full bilingual with 5 topics + decisions',
  agentType: 'BOARD_NARRATIVE',
  params: {
    institutionId: 'golden-020',
    outputType: 'BOARD_PACKET',
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [55, 80],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 600,
  },
};
