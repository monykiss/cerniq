import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 12 — Board Narrative Agent.
// Mirrors Vol.1 Bible §12. Board-language translation of financial metrics.

export const BoardOutputType = z.enum([
  'BOARD_PACKET',
  'TALKING_POINTS',
  'RISK_DASHBOARD_NARRATIVE',
]);

export const BoardTopicSchema = z.object({
  topic: z.string().min(1),
  situation: z.string().min(1),
  situationEs: z.string().min(1),
  whyItMatters: z.string().min(1),
  whyItMattersEs: z.string().min(1),
  whatWeAreDoing: z.string().min(1),
  whatWeAreDoingEs: z.string().min(1),
  boardMustKnow: z.string().optional(),
  boardMustKnowEs: z.string().optional(),
});

export const BoardNarrativeOutputSchema = z.object({
  agentId: z.literal('board_narrative'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  outputType: BoardOutputType,
  topics: z.array(BoardTopicSchema).min(3).max(7),
  decisionsRequired: z.array(
    z.object({
      decision: z.string().min(1),
      decisionEs: z.string().min(1),
      urgency: z.enum(['IMMEDIATE', 'NEXT_MEETING', 'INFORMATIONAL']),
      context: z.string().min(1),
    }),
  ),
  talkingPoints: z
    .array(
      z.object({
        point: z.string().max(120),
        pointEs: z.string().max(120),
      }),
    )
    .min(5)
    .max(7)
    .optional(),
  riskDashboardNarrative: z
    .object({
      capital: z.string().min(1),
      capitalEs: z.string().min(1),
      liquidity: z.string().min(1),
      liquidityEs: z.string().min(1),
      rateRisk: z.string().min(1),
      rateRiskEs: z.string().min(1),
      credit: z.string().min(1),
      creditEs: z.string().min(1),
    })
    .optional(),
  narrative: z.string().min(1),
  narrativeEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type BoardNarrativeOutput = z.infer<typeof BoardNarrativeOutputSchema>;
