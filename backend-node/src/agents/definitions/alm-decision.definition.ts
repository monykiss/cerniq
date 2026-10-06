import { AgentId } from '@prisma/client';
import { ALMDecisionOutputSchema } from '../contracts/alm-decision.contracts';
import {
  ALM_DECISION_SYSTEM_PROMPT,
  ALM_DECISION_PROMPT_VERSION,
} from '../prompts/alm-decision.prompt';
import type { AgentDefinition } from './agent.definition';

export const AlmDecisionAgent: AgentDefinition<typeof ALMDecisionOutputSchema> =
  {
    agentId: AgentId.ALM_DECISION,
    agentVersion: '1.0.0',
    promptVersion: ALM_DECISION_PROMPT_VERSION,
    systemPrompt: ALM_DECISION_SYSTEM_PROMPT,
    allowedTools: new Set([
      'runFullSwarm',
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
      'getHealthScore',
    ]),
    outputSchema: ALMDecisionOutputSchema,
    runTimeoutMs: 180_000,
    maxTurns: 15,
    buildUserMessage(input: unknown) {
      const meta = (input ?? {}) as Record<string, unknown>;
      const region = meta.region ?? 'PR';
      const language = meta.language ?? 'bilingual';
      const institutionId = meta.institutionId ?? 'unknown';
      return [
        `Analyze institution ${institutionId}. Region: ${region}. Language: ${language}.`,
        'Follow the tool-call sequence specified in your system prompt.',
        'Return a single JSON object matching the ALMDecisionOutput schema.',
      ].join('\n');
    },
  };
