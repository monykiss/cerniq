import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden024CapitalAdequacyFocus: GoldenCase = {
  id: 'golden-024',
  name: 'Capital near PCA trigger — exam focused on net worth erosion',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-024',
    examType: 'annual',
    netWorthRatio: 6.5,
  },
  expected: {
    topRiskDomain: 'Capital Risk',
    hasMinDollarQuantification: false,
    healthScoreRange: [25, 50],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['NCUA', 'COSSEC'],
  },
};
