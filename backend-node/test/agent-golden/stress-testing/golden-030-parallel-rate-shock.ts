import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden030ParallelRateShock: GoldenCase = {
  id: 'golden-030',
  name: 'Parallel rate shock ±300bp with adequate capital buffer',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-030',
    scenarios: ['parallel_up_300', 'parallel_down_300'],
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [45, 70],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
    requiredRegulatoryCodes: ['12 CFR 741.3', 'COSSEC'],
  },
};
