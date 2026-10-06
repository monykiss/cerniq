import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 08 — Exam Prep Agent.
// Mirrors Vol.1 Bible §08. CAMEL self-assessment + 24-item governance.

export const CamelRating = z.number().int().min(1).max(5);

export const CamelComponentSchema = z.object({
  component: z.enum([
    'CAPITAL',
    'ASSET_QUALITY',
    'MANAGEMENT',
    'EARNINGS',
    'LIQUIDITY',
  ]),
  score: CamelRating,
  finding: z.string().min(1),
  findingEs: z.string().min(1),
  remediation: z.string().min(1),
  remediationEs: z.string().min(1),
});

export const RedFlagSchema = z.object({
  issue: z.string().min(1),
  issueEs: z.string().min(1),
  likelyExaminerComment: z.string().min(1),
  preparedResponse: z.string().min(1),
  preparedResponseEs: z.string().min(1),
});

export const DocStatus = z.enum(['READY', 'IN_PREPARATION', 'MISSING']);

export const DocumentChecklistItemSchema = z.object({
  document: z.string().min(1),
  status: DocStatus,
  owner: z.string().optional(),
  dueDate: IsoTimestampSchema.optional(),
});

export const RemediationItemSchema = z.object({
  priority: z.number().int().positive(),
  item: z.string().min(1),
  itemEs: z.string().min(1),
  camelComponent: z.string().min(1),
  estimatedImpactOnRating: z.string().min(1),
  deadline: IsoTimestampSchema,
  owner: z.string().min(1),
});

export const ExamPrepOutputSchema = z.object({
  agentId: z.literal('exam_prep'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  camelAssessment: z.object({
    composite: CamelRating,
    components: z.array(CamelComponentSchema).length(5),
  }),
  governanceChecklist: z.object({
    total: z.literal(24),
    passed: z.number().int().min(0).max(24),
    items: z.array(
      z.object({
        item: z.string().min(1),
        status: z.enum(['PASS', 'FAIL', 'PARTIAL']),
      }),
    ),
  }),
  redFlags: z.array(RedFlagSchema),
  documentChecklist: z.array(DocumentChecklistItemSchema),
  remediationPlan: z.array(RemediationItemSchema),
  managementLetterDraft: z.string().min(1),
  managementLetterDraftEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type ExamPrepOutput = z.infer<typeof ExamPrepOutputSchema>;
