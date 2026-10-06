import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Vol2 principle #4: "A swarm model failure reduces confidence, never crashes
 * the run. The agent surfaces 'Partial data — model X unavailable' in output."
 *
 * Simulates 3 of 12 swarm models failing (earlyWarning, depositBeta,
 * repricingGap). The agent should still produce a decision, mark the missing
 * dimensions, and lower the health score confidence. The eval harness checks
 * that the output includes a partial-data marker and that the agent did NOT
 * hallucinate values for the failed models.
 */
export const golden008GracefulDegradation: GoldenCase = {
  id: 'golden-008',
  name: 'Graceful degradation (3 swarm models failed, partial output required)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-008',
    simulatedModelFailures: ['earlyWarning', 'depositBeta', 'repricingGap'],
  },
  expected: {
    hasMinDollarQuantification: true,
    toolsCalledMin: 6,
    maxWords: 600,
  },
};
