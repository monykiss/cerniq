import { AgentId } from '@prisma/client';
import { CommitteeReportOutputSchema } from '../contracts/committee-report.contracts';
import {
  COMMITTEE_REPORT_SYSTEM_PROMPT,
  COMMITTEE_REPORT_PROMPT_VERSION,
} from '../prompts/committee-report.prompt';
import type { AgentDefinition } from './agent.definition';

export const CommitteeReportAgent: AgentDefinition<
  typeof CommitteeReportOutputSchema
> = {
  agentId: AgentId.COMMITTEE_REPORT,
  agentVersion: '1.0.0',
  promptVersion: COMMITTEE_REPORT_PROMPT_VERSION,
  systemPrompt: COMMITTEE_REPORT_SYSTEM_PROMPT,
  allowedTools: new Set([] as string[]),
  outputSchema: CommitteeReportOutputSchema,
  runTimeoutMs: 120_000,
  maxTurns: 6,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    const sourceRunId = meta.sourceRunId ?? 'MISSING';
    const committeeType = meta.committeeType ?? 'board';
    const language = meta.language ?? 'bilingual';
    const decision = meta.decision ? JSON.stringify(meta.decision) : '{}';
    return [
      `Committee: ${committeeType}. Language: ${language}. Source run: ${sourceRunId}.`,
      'The ALMDecisionOutput from Agent 01 is below. Transform it into a governance-grade committee report matching the CommitteeReportOutput schema.',
      '',
      decision,
    ].join('\n');
  },
};
