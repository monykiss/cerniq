import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden019QuarterlyBenchmarking: GoldenCase = {
  id: 'golden-019',
  name: 'Quarterly peer benchmarking: $250M PR cooperativa vs cohort',
  agentType: 'PEER_INTELLIGENCE',
  params: {
    institutionId: 'golden-019',
    peerCohortType: 'asset_size',
    assetRangeMillions: [100, 500],
  },
  expected: {
    topRiskDomain: 'Competitive Position',
    hasMinDollarQuantification: true,
    healthScoreRange: [50, 80],
    hasRegulatoryReference: false,
    toolsCalledMin: 3,
    bilingualRequired: true,
    maxWords: 500,
  },
};
