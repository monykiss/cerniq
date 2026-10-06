import { AgentId } from '@prisma/client';
import { PeerIntelligenceOutputSchema } from '../contracts/peer-intelligence.contracts';
import {
  PEER_INTELLIGENCE_SYSTEM_PROMPT,
  PEER_INTELLIGENCE_PROMPT_VERSION,
} from '../prompts/peer-intelligence.prompt';
import type { AgentDefinition } from './agent.definition';

export const PeerIntelligenceAgent: AgentDefinition<
  typeof PeerIntelligenceOutputSchema
> = {
  agentId: AgentId.PEER_INTELLIGENCE,
  agentVersion: '1.0.0',
  promptVersion: PEER_INTELLIGENCE_PROMPT_VERSION,
  systemPrompt: PEER_INTELLIGENCE_SYSTEM_PROMPT,
  allowedTools: new Set([
    'getPeerBenchmark',
    'getPeerAnalytics',
    'getHealthScore',
  ]),
  outputSchema: PeerIntelligenceOutputSchema,
  runTimeoutMs: 60_000,
  maxTurns: 8,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    return [
      `Generate peer intelligence digest for institution ${meta.institutionId ?? 'unknown'}.`,
      'Cover all metrics in the METRICS UNIVERSE. Flag quartile changes vs prior quarter.',
      'Return a single JSON object matching the PeerIntelligenceOutput schema.',
    ].join('\n');
  },
};
