import { AgentId } from '@prisma/client';
import { RegulatoryComplianceOutputSchema } from '../contracts/regulatory-compliance.contracts';
import {
  REGULATORY_COMPLIANCE_SYSTEM_PROMPT,
  REGULATORY_COMPLIANCE_PROMPT_VERSION,
} from '../prompts/regulatory-compliance.prompt';
import type { AgentDefinition } from './agent.definition';

export const RegulatoryComplianceAgent: AgentDefinition<
  typeof RegulatoryComplianceOutputSchema
> = {
  agentId: AgentId.REGULATORY_COMPLIANCE,
  agentVersion: '1.0.0',
  promptVersion: REGULATORY_COMPLIANCE_PROMPT_VERSION,
  systemPrompt: REGULATORY_COMPLIANCE_SYSTEM_PROMPT,
  allowedTools: new Set(['getComplianceCalendar']),
  outputSchema: RegulatoryComplianceOutputSchema,
  runTimeoutMs: 60_000,
  maxTurns: 6,
  buildUserMessage(input: unknown) {
    const meta = (input ?? {}) as Record<string, unknown>;
    return [
      `Generate compliance dashboard for institution ${meta.institutionId ?? 'unknown'}.`,
      meta.deadlineId
        ? `Prepare filing package for deadline: ${meta.deadlineId}.`
        : 'Cover all deadlines in next 90 days.',
      'Return a single JSON object matching the RegulatoryComplianceOutput schema.',
    ].join('\n');
  },
};
