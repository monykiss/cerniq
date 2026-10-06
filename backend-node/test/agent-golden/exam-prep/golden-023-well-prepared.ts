import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden023WellPrepared: GoldenCase = {
  id: 'golden-023',
  name: 'Well-prepared institution — 24/24 checklist items, strong CAMEL',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-023',
    examType: 'annual',
    governanceDocCount: 24,
  },
  expected: {
    topRiskDomain: 'Earnings',
    hasMinDollarQuantification: false,
    healthScoreRange: [75, 100],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 500,
  },
};
