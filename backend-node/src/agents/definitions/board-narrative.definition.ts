import { AgentId } from '@prisma/client';
import { BoardNarrativeOutputSchema } from '../contracts/board-narrative.contracts';
import {
  BOARD_NARRATIVE_SYSTEM_PROMPT,
  BOARD_NARRATIVE_PROMPT_VERSION,
} from '../prompts/board-narrative.prompt';
import type { AgentDefinition } from './agent.definition';

export const BoardNarrativeAgent: AgentDefinition<
  typeof BoardNarrativeOutputSchema
> = {
  agentId: AgentId.BOARD_NARRATIVE,
  agentVersion: '1.0.0',
  promptVersion: BOARD_NARRATIVE_PROMPT_VERSION,
  systemPrompt: BOARD_NARRATIVE_SYSTEM_PROMPT,
  allowedTools: new Set([]),
  outputSchema: BoardNarrativeOutputSchema,
  runTimeoutMs: 90_000,
  maxTurns: 6,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    const outputType = meta.outputType ?? 'BOARD_PACKET';
    return [
      `Generate ${outputType} for institution ${meta.institutionId ?? 'unknown'}.`,
      meta.sourceRunId ? `Source analysis run: ${meta.sourceRunId}.` : '',
      'Translate all financial metrics into board-accessible language.',
      'Return a single JSON object matching the BoardNarrativeOutput schema.',
    ]
      .filter(Boolean)
      .join('\n');
  },
};
