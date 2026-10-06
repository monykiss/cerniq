import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden021FirstExamUnprepared: GoldenCase = {
  id: 'golden-021',
  name: 'First COSSEC exam — minimal governance docs, incomplete checklist',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-021',
    examType: 'first',
    governanceDocCount: 3,
  },
  expected: {
    topRiskDomain: 'Management',
    hasMinDollarQuantification: false,
    healthScoreRange: [15, 40],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['NCUA Letter 06-CU-13', 'COSSEC'],
  },
};
