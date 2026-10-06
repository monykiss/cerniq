import { z } from 'zod';
import { LanguageSchema } from './common.contracts';

// Output schema for Agent 04 — CFO Copilot Agent.
// Conversational, so the "output" is a single turn (assistant message +
// suggested follow-ups). Tool results are captured in the audit log, not
// duplicated here.

export const CFOCopilotFollowupSchema = z.object({
  en: z.string().min(1),
  es: z.string().min(1),
});

export const CFOCopilotOutputSchema = z.object({
  agentId: z.literal('cfo_copilot'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  sessionId: z.string().min(1),
  language: LanguageSchema.exclude(['bilingual']),
  /// Bible §04: max 300 words. 300-word cap enforced at schema level.
  message: z.string().refine((s) => wordCount(s) <= 300, {
    message: 'CFO Copilot response exceeds 300-word limit (Bible §04)',
  }),
  /// Exactly 4 context-aware follow-ups per Bible §04. Less is a bug.
  followups: z.array(CFOCopilotFollowupSchema).length(4),
  toolsCalled: z.array(z.string()),
});

export type CFOCopilotOutput = z.infer<typeof CFOCopilotOutputSchema>;

function wordCount(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}
