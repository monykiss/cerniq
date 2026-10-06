import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden013CossecScenarioBattery: GoldenCase = {
  id: 'golden-013',
  name: 'Full COSSEC scenario battery including PR-specific shocks',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-013',
    includeHurricane: true,
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [40, 75],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
    requiredRegulatoryCodes: ['12 CFR 741.3'],
  },
};
