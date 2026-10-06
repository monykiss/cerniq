import { AgentId } from '@prisma/client';
import { CapitalOptimizerOutputSchema } from '../contracts/capital-optimizer.contracts';
import {
  CAPITAL_OPTIMIZER_SYSTEM_PROMPT,
  CAPITAL_OPTIMIZER_PROMPT_VERSION,
} from '../prompts/capital-optimizer.prompt';
import type { AgentDefinition } from './agent.definition';

export const CapitalOptimizerAgent: AgentDefinition<
  typeof CapitalOptimizerOutputSchema
> = {
  agentId: AgentId.CAPITAL_OPTIMIZER,
  agentVersion: '1.0.0',
  promptVersion: CAPITAL_OPTIMIZER_PROMPT_VERSION,
  systemPrompt: CAPITAL_OPTIMIZER_SYSTEM_PROMPT,
  allowedTools: new Set([
    'runFullSwarm',
    'runRateShock',
    'getLCR',
    'getCapitalAdequacy',
    'getPeerBenchmark',
    'getRepricingGap',
    'getDepositBeta',
  ]),
  outputSchema: CapitalOptimizerOutputSchema,
  runTimeoutMs: 180_000,
  maxTurns: 15,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    return [
      `Optimize balance sheet for institution ${meta.institutionId ?? 'unknown'}.`,
      'Follow the 6-step optimization process in your system prompt.',
      'Return a single JSON object matching the CapitalOptimizerOutput schema.',
    ].join('\n');
  },
};
