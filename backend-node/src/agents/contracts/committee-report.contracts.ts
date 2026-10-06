import { z } from 'zod';
import {
  CommitteeTypeSchema,
  LanguageSchema,
  DeadlineSchema,
  OwnerSchema,
} from './common.contracts';

export const RecommendationItemSchema = z.object({
  index: z.number().int().min(1),
  action: z.string().min(1),
  owner: OwnerSchema,
  deadline: DeadlineSchema,
  expectedImpact: z.string().min(1),
  regulatoryRef: z.string().min(1),
});

export const CalendarItemSchema = z.object({
  dueDate: z.string().min(1),
  filing: z.string().min(1),
  status: z.enum(['READY', 'IN_PREPARATION', 'MISSING', 'OVERDUE']),
  owner: z.string().min(1),
  regulatoryRef: z.string().min(1),
});

export const CommitteeReportOutputSchema = z.object({
  agentId: z.literal('committee_report'),
  sourceRunId: z.string().min(1),
  committeeType: CommitteeTypeSchema,
  language: LanguageSchema,
  sections: z.object({
    executiveSummary: z.string().refine((s) => wordCount(s) <= 150, {
      message: 'executive summary exceeds 150-word limit (Bible §02)',
    }),
    financialPosition: z.string().min(1),
    interestRateRisk: z.string().min(1),
    creditConcentration: z.string().min(1),
    liquidityRisk: z.string().min(1),
    peerComparison: z.string().min(1),
    recommendations: z.array(RecommendationItemSchema).min(1),
    regulatoryCalendar: z.array(CalendarItemSchema),
  }),
  pdfPath: z.string().min(1),
  wordCount: z.number().int().nonnegative(),
  bilingualEsPath: z.string().min(1).optional(),
});

export type CommitteeReportOutput = z.infer<typeof CommitteeReportOutputSchema>;

function wordCount(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}
