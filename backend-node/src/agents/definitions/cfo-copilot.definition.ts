import { AgentId } from '@prisma/client';
import { CFOCopilotOutputSchema } from '../contracts/cfo-copilot.contracts';
import {
  CFO_COPILOT_SYSTEM_PROMPT,
  CFO_COPILOT_PROMPT_VERSION,
} from '../prompts/cfo-copilot.prompt';
import type { AgentDefinition } from './agent.definition';

export const CFOCopilotAgent: AgentDefinition<typeof CFOCopilotOutputSchema> = {
  agentId: AgentId.CFO_COPILOT,
  agentVersion: '1.0.0',
  promptVersion: CFO_COPILOT_PROMPT_VERSION,
  systemPrompt: CFO_COPILOT_SYSTEM_PROMPT,
  allowedTools: new Set([
    'runRateShock',
    'getLCR',
    'getCECL',
    'getConcentration',
    'getIRRPolicy',
    'getPeerBenchmark',
    'getRepricingGap',
    'runMonteCarlo',
    'getEWS',
    'getCAMEL',
    'getFTP',
    'getDepositBeta',
    'getHealthScore',
  ]),
  outputSchema: CFOCopilotOutputSchema,
  runTimeoutMs: 45_000,
  maxTurns: 8,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    const query = String(meta.query ?? '').trim();
    if (!query) {
      throw new Error('cfo_copilot: input.query is required');
    }
    return query;
  },
};
