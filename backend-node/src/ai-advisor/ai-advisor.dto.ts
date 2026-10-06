import { z } from 'zod';

// ─── AI Advisor DTO schemas (Zod-first, consistent with agents module) ──────

export const AskQuestionSchema = z.object({
  institutionId: z.string().min(1),
  question: z.string().min(1).max(2000),
  sessionId: z.string().min(1).optional(),
  language: z.enum(['es', 'en', 'both']).default('both'),
});

export type AskQuestionDto = z.infer<typeof AskQuestionSchema>;

export const SessionParamsSchema = z.object({
  institutionId: z.string().min(1),
});

export type SessionParamsDto = z.infer<typeof SessionParamsSchema>;

export const SessionHistoryParamsSchema = z.object({
  institutionId: z.string().min(1),
  sessionId: z.string().min(1),
});

export type SessionHistoryParamsDto = z.infer<
  typeof SessionHistoryParamsSchema
>;

export const DeleteSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export type DeleteSessionParamsDto = z.infer<typeof DeleteSessionParamsSchema>;
