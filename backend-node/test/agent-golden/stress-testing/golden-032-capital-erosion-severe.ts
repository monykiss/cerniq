import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden032CapitalErosionSevere: GoldenCase = {
  id: 'golden-032',
  name: 'FRB severely adverse — capital breaches minimum with CECL spike',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-032',
    scenarios: ['frb_severely_adverse'],
    ceclMultiplier: 2.5,
  },
  expected: {
    topRiskDomain: 'Capital Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [15, 40],
    hasRegulatoryReference: true,
    toolsCalledMin: 5,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['12 CFR 741.3', 'NCUA'],
  },
};
