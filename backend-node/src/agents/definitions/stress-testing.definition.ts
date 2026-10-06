import { AgentId } from '@prisma/client';
import { StressTestOutputSchema } from '../contracts/stress-testing.contracts';
import {
  STRESS_TESTING_SYSTEM_PROMPT,
  STRESS_TESTING_PROMPT_VERSION,
} from '../prompts/stress-testing.prompt';
import type { AgentDefinition } from './agent.definition';

export const StressTestingAgent: AgentDefinition<
  typeof StressTestOutputSchema
> = {
  agentId: AgentId.STRESS_TESTING,
  agentVersion: '1.0.0',
  promptVersion: STRESS_TESTING_PROMPT_VERSION,
  systemPrompt: STRESS_TESTING_SYSTEM_PROMPT,
  allowedTools: new Set([
    'runFullSwarm',
    'runRateShock',
    'getIRRPolicy',
    'getLCR',
    'getCapitalAdequacy',
    'runMonteCarlo',
  ]),
  outputSchema: StressTestOutputSchema,
  runTimeoutMs: 120_000,
  maxTurns: 12,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    const institutionId = meta.institutionId ?? 'unknown';
    const region = meta.region ?? 'PR';
    const scenarioIds = meta.scenarioIds as string[] | undefined;
    const lines = [
      `Run stress test suite for institution ${institutionId}. Region: ${region}.`,
      region === 'PR'
        ? 'Include all PR-specific scenarios (hurricane, recession, liquidity crisis).'
        : '',
      scenarioIds
        ? `Custom scenarios requested: ${scenarioIds.join(', ')}.`
        : '',
      'Return a single JSON object matching the StressTestOutput schema.',
    ];
    return lines.filter(Boolean).join('\n');
  },
};
