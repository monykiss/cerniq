import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden016CamelSelfAssessment: GoldenCase = {
  id: 'golden-016',
  name: 'CAMEL self-assessment with 24-item governance checklist, pre-exam',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-016',
    examType: 'annual',
  },
  expected: {
    topRiskDomain: 'Earnings',
    hasMinDollarQuantification: false,
    healthScoreRange: [45, 75],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['NCUA Letter 06-CU-13'],
  },
};
