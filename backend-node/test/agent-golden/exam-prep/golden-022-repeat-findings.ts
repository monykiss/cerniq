import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden022RepeatFindings: GoldenCase = {
  id: 'golden-022',
  name: 'Repeat COSSEC findings from prior exam — remediation verification',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-022',
    examType: 'follow_up',
    priorFindingCount: 8,
  },
  expected: {
    hasMinDollarQuantification: false,
    healthScoreRange: [30, 55],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['COSSEC'],
  },
};
