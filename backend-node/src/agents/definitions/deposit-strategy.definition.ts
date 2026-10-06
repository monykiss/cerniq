import { AgentId } from '@prisma/client';
import { DepositStrategyOutputSchema } from '../contracts/deposit-strategy.contracts';
import {
  DEPOSIT_STRATEGY_SYSTEM_PROMPT,
  DEPOSIT_STRATEGY_PROMPT_VERSION,
} from '../prompts/deposit-strategy.prompt';
import type { AgentDefinition } from './agent.definition';

export const DepositStrategyAgent: AgentDefinition<
  typeof DepositStrategyOutputSchema
> = {
  agentId: AgentId.DEPOSIT_STRATEGY,
  agentVersion: '1.0.0',
  promptVersion: DEPOSIT_STRATEGY_PROMPT_VERSION,
  systemPrompt: DEPOSIT_STRATEGY_SYSTEM_PROMPT,
  allowedTools: new Set([
    'getDepositBeta',
    'getDepositDecay',
    'getDepositPricingEngine',
    'getCostOfFunds',
    'getDepositMixOptimizer',
    'getMaturityLadder',
  ]),
  outputSchema: DepositStrategyOutputSchema,
  runTimeoutMs: 90_000,
  maxTurns: 10,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    return [
      `Analyze deposit strategy for institution ${meta.institutionId ?? 'unknown'}.`,
      'Follow the 6-step tool sequence in your system prompt.',
      'Return a single JSON object matching the DepositStrategyOutput schema.',
    ].join('\n');
  },
};
