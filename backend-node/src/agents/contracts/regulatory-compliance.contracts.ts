import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 07 — Regulatory Compliance Agent.
// Mirrors Vol.1 Bible §07. COSSEC / NCUA / OCIF / FinCEN / CFPB.

export const ComplianceRag = z.enum(['RED', 'AMBER', 'GREEN']);
export type ComplianceRag = z.infer<typeof ComplianceRag>;

export const DeadlineCategory = z.enum([
  'FILING',
  'POLICY',
  'AUDIT',
  'EXAM',
  'TRAINING',
]);

export const ComplianceItemSchema = z.object({
  deadlineId: z.string().min(1),
  category: DeadlineCategory,
  description: z.string().min(1),
  descriptionEs: z.string().min(1),
  regulatoryBody: z.enum(['COSSEC', 'NCUA', 'OCIF', 'FinCEN', 'CFPB']),
  regulationRef: z.string().min(1),
  dueDate: IsoTimestampSchema,
  daysUntilDue: z.number().int(),
  daysOverdue: z.number().int().nonnegative().optional(),
  rag: ComplianceRag,
  preparationSteps: z.array(z.string()).optional(),
  dataRequirements: z.array(z.string()).optional(),
  status: z.enum(['COMPLETE', 'IN_PREPARATION', 'NOT_STARTED', 'OVERDUE']),
});

export const RegulatoryComplianceOutputSchema = z.object({
  agentId: z.literal('regulatory_compliance'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  dashboard: z.object({
    red: z.array(ComplianceItemSchema),
    amber: z.array(ComplianceItemSchema),
    green: z.array(ComplianceItemSchema),
  }),
  preparationPackages: z
    .array(
      z.object({
        deadlineId: z.string().min(1),
        dataRequirements: z.array(z.string()),
        draftSections: z.array(z.string()),
        reviewSequence: z.array(z.string()),
        submissionInstructions: z.string().min(1),
      }),
    )
    .optional(),
  summary: z.string().min(1),
  summaryEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type RegulatoryComplianceOutput = z.infer<
  typeof RegulatoryComplianceOutputSchema
>;
