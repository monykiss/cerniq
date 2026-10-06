import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden035CombinedMultiFactor: GoldenCase = {
  id: 'golden-035',
  name: 'Combined multi-factor stress — rate + credit + liquidity simultaneous',
  agentType: 'STRESS_TESTING',
  params: {
    institutionId: 'golden-035',
    scenarios: ['parallel_up_200', 'credit_deterioration', 'deposit_runoff'],
    creditShockPct: 3.0,
    depositRunoffPct: 10,
  },
  expected: {
    hasMinDollarQuantification: true,
    healthScoreRange: [10, 35],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['COSSEC'],
  },
};
