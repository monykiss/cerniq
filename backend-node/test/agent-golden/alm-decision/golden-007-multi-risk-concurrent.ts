import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Stress test for the agent's prioritization logic. Balance sheet has
 * simultaneous HIGH severity in rate risk, liquidity, AND concentration.
 * Agent must rank by severity × urgency × financial impact (Vol1 §2.1 rule 3)
 * and produce actionable recommendations for all three, not collapse into
 * a single "you have many problems" narrative.
 */
export const golden007MultiRiskConcurrent: GoldenCase = {
  id: 'golden-007',
  name: 'Multi-risk concurrent (rate + liquidity + concentration all HIGH)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-007',
  },
  expected: {
    hasMinDollarQuantification: true,
    hasRegulatoryReference: true,
    toolsCalledMin: 8,
    maxWords: 600,
  },
};
