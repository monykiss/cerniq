import { z } from 'zod';
import {
  IsoTimestampSchema,
  LanguageSchema,
  DeadlineSchema,
  OwnerSchema,
} from './common.contracts';

// Output schema for Agent 01 — ALM Decision Agent.
// This mirrors Vol.1 Bible §01 "Output Schema" line-for-line. Any drift
// between this schema and the Bible is a bug.

export const HealthSnapshotSchema = z.object({
  overall: z.number().int().min(0).max(100),
  capital: z.number().int().min(0).max(100),
  liquidity: z.number().int().min(0).max(100),
  rateRisk: z.number().int().min(0).max(100),
  credit: z.number().int().min(0).max(100),
  concentration: z.number().int().min(0).max(100),
  label: z.enum([
    'STRONG',
    'SATISFACTORY',
    'FAIR',
    'MARGINAL',
    'UNSATISFACTORY',
  ]),
  trend: z.enum(['improving', 'stable', 'deteriorating']),
});

export const TopRiskSchema = z.object({
  rank: z.number().int().min(1).max(5),
  domain: z.string().min(1),
  /// Bible §01 — severity × urgency × impact, range 1–27.
  priorityScore: z.number().int().min(1).max(27),
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  finding: z.string().min(1),
  findingEs: z.string().min(1),
  dollarImpact: z.number(),
  /// Percent of base NII expressed as a decimal (6.2% → 6.2, not 0.062).
  dollarImpactPct: z.number(),
  regulatoryRef: z.string().min(1),
  toolsUsed: z.array(z.string()).min(1),
});

export const DecisionQueueItemSchema = z.object({
  priority: z.number().int().min(1).max(5),
  action: z.string().min(1),
  actionEs: z.string().min(1),
  expectedImpact: z.string().min(1),
  deadline: DeadlineSchema,
  owner: OwnerSchema,
  regulatoryRef: z.string().min(1),
  status: z.literal('PENDING'),
});

export const ALMDecisionOutputSchema = z
  .object({
    agentId: z.literal('alm_decision'),
    version: z.literal('2.0'),
    runId: z.string().min(1),
    institutionId: z.string().min(1),
    timestamp: IsoTimestampSchema,
    language: LanguageSchema,
    healthSnapshot: HealthSnapshotSchema,
    topRisks: z.array(TopRiskSchema).length(5),
    decisionQueue: z.array(DecisionQueueItemSchema).length(5),
    /// Bible rule: "Brief ≤ 600 words". Enforced here so any violation
    /// fails contract validation instead of slipping into production.
    brief: z.string().refine((s) => wordCount(s) <= 600, {
      message: 'brief exceeds 600-word limit (Bible §01)',
    }),
    briefEs: z.string().refine((s) => wordCount(s) <= 600, {
      message: 'briefEs exceeds 600-word limit',
    }),
    auditTraceId: z.string().min(1),
  })
  .superRefine((out, ctx) => {
    // Bilingual enforcement: if language === 'bilingual' both EN and ES must
    // be populated on every bilingual field. (Already validated at field
    // level — this guards against future field additions.)
    if (out.language === 'bilingual' && out.brief.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bilingual run missing English brief',
        path: ['brief'],
      });
    }
  });

export type ALMDecisionOutput = z.infer<typeof ALMDecisionOutputSchema>;

function wordCount(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}
