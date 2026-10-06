import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden027AssetQualityConcern: GoldenCase = {
  id: 'golden-027',
  name: 'Asset quality concern — delinquency spike, CECL provisioning gap',
  agentType: 'EXAM_PREP',
  params: {
    institutionId: 'golden-027',
    examType: 'annual',
    delinquencyRate: 5.2,
  },
  expected: {
    topRiskDomain: 'Asset Quality',
    hasMinDollarQuantification: false,
    healthScoreRange: [25, 50],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
  },
};
