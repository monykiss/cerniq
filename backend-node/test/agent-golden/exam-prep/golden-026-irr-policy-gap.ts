import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden026IrrPolicyGap: GoldenCase = {
  id: 'golden-026',
  name: 'IRR policy deficient — no board-approved limits, examiner critical finding',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-026',
    examType: 'annual',
    hasIrrPolicy: false,
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: false,
    healthScoreRange: [20, 45],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['NCUA Letter 06-CU-13'],
  },
};
