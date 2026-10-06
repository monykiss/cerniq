import { AgentId } from '@prisma/client';
import { ExamPrepOutputSchema } from '../contracts/exam-prep.contracts';
import {
  EXAM_PREP_SYSTEM_PROMPT,
  EXAM_PREP_PROMPT_VERSION,
} from '../prompts/exam-prep.prompt';
import type { AgentDefinition } from './agent.definition';

export const ExamPrepAgent: AgentDefinition<typeof ExamPrepOutputSchema> = {
  agentId: AgentId.EXAM_PREP,
  agentVersion: '1.0.0',
  promptVersion: EXAM_PREP_PROMPT_VERSION,
  systemPrompt: EXAM_PREP_SYSTEM_PROMPT,
  allowedTools: new Set([
    'getCAMEL',
    'getExamPrep',
    'getIRRPolicy',
    'runFullSwarm',
    'getConcentration',
    'getCapitalAdequacy',
  ]),
  outputSchema: ExamPrepOutputSchema,
  runTimeoutMs: 120_000,
  maxTurns: 12,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    const examDate = meta.examDate ? ` Scheduled exam: ${meta.examDate}.` : '';
    return [
      `Prepare exam readiness package for institution ${meta.institutionId ?? 'unknown'}.${examDate}`,
      'Follow the 6-step protocol in your system prompt.',
      'Return a single JSON object matching the ExamPrepOutput schema.',
    ].join('\n');
  },
};
