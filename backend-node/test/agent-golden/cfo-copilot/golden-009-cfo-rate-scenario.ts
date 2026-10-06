import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Blueprint §2.4 — CFO Copilot Agent (Stickiness Engine).
 *
 * Conversation-style query: "What happens if rates rise 200bps?" The copilot
 * should call runRateShock with the specified scenario, synthesize the NII/EVE
 * impact in ≤300 words (Vol3 failure taxonomy word cap), and suggest 2-3
 * follow-up questions. No hedging. CFO-level prose.
 */
export const golden009CfoRateScenario: GoldenCase = {
  id: 'golden-009',
  name: 'CFO Copilot — rate scenario query (+200bps)',
  agentType: 'CFO_COPILOT',
  params: {
    query: 'What happens if rates rise 200bps?',
    sessionId: 'golden-session-009',
  },
  expected: {
    hasMinDollarQuantification: true,
    hasRegulatoryReference: false,
    toolsCalledMin: 2,
    maxWords: 300,
  },
};
