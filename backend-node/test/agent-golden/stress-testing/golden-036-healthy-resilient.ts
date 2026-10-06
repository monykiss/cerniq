import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden036HealthyResilient: GoldenCase = {
  id: 'golden-036',
  name: 'Healthy institution — all scenarios pass with comfortable buffers',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-036',
    scenarios: ['parallel_up_300', 'parallel_down_300', 'hurricane_cat4'],
  },
  expected: {
    hasMinDollarQuantification: true,
    healthScoreRange: [70, 100],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 500,
  },
};
