import { AgentId } from '@prisma/client';
import { LoanPricingOutputSchema } from '../contracts/loan-pricing.contracts';
import {
  LOAN_PRICING_SYSTEM_PROMPT,
  LOAN_PRICING_PROMPT_VERSION,
} from '../prompts/loan-pricing.prompt';
import type { AgentDefinition } from './agent.definition';

export const LoanPricingAgent: AgentDefinition<typeof LoanPricingOutputSchema> =
  {
    agentId: AgentId.LOAN_PRICING,
    agentVersion: '1.0.0',
    promptVersion: LOAN_PRICING_PROMPT_VERSION,
    systemPrompt: LOAN_PRICING_SYSTEM_PROMPT,
    allowedTools: new Set([
      'getFTP',
      'getCECL',
      'getConcentration',
      'getCapitalAdequacy',
      'getPeerBenchmark',
    ]),
    outputSchema: LoanPricingOutputSchema,
    runTimeoutMs: 30_000,
    maxTurns: 8,
    buildUserMessage(input: unknown) {
      const meta = (input ?? {}) as Record<string, unknown>;
      return [
        `Price loan for institution ${meta.institutionId ?? 'unknown'}.`,
        meta.amount
          ? `Amount: $${meta.amount}. Term: ${meta.termMonths ?? '?'}mo.`
          : '',
        meta.sector
          ? `Sector: ${meta.sector}. Risk grade: ${meta.riskGrade ?? 'unknown'}.`
          : '',
        'Return a single JSON object matching the LoanPricingOutput schema.',
      ]
        .filter(Boolean)
        .join('\n');
    },
  };
