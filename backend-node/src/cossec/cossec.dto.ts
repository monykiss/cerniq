import { z } from 'zod';

// ─── COSSEC Finding Severity ───────────────────────────────────────────────

export const CossecFindingSeverityEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type CossecFindingSeverity = z.infer<typeof CossecFindingSeverityEnum>;

// ─── Parsed Finding (from Python microservice) ─────────────────────────────

export const ParsedFindingSchema = z.object({
  institutionName: z.string().min(1).max(500),
  examDate: z.string().optional(),
  category: z.string().min(1).max(100),
  severity: CossecFindingSeverityEnum,
  findingText: z.string().min(1).max(10_000),
  findingTextEs: z.string().max(10_000).optional(),
  recommendation: z.string().max(10_000).optional(),
  recommendationEs: z.string().max(10_000).optional(),
  circularLetterRef: z.string().max(200).optional(),
  rawPdfSource: z.string().max(1000).optional(),
  parserConfidence: z.number().min(0).max(1),
});
export type ParsedFinding = z.infer<typeof ParsedFindingSchema>;

// ─── Ingest Payload (POST /admin/api/cossec/ingest) ────────────────────────

export const CossecIngestPayloadSchema = z.object({
  examYear: z.number().int().min(2000).max(2100),
  source: z.string().min(1).max(500),
  findings: z.array(ParsedFindingSchema).min(1).max(5000),
});
export type CossecIngestPayload = z.infer<typeof CossecIngestPayloadSchema>;

// ─── Ingest Result ─────────────────────────────────────────────────────────

export interface IngestResult {
  totalReceived: number;
  matched: number;
  unmatched: number;
  created: number;
  duplicatesSkipped: number;
  unmatchedInstitutions: string[];
}

// ─── Match Result ──────────────────────────────────────────────────────────

export interface MatchResult {
  matched: boolean;
  prospectInstitutionId?: string;
  confidence: number;
  matchedName?: string;
}

// ─── Findings Query (GET /admin/api/cossec/findings) ───────────────────────

export const FindingsQuerySchema = z.object({
  category: z.string().min(1).optional(),
  severity: CossecFindingSeverityEnum.optional(),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type FindingsQuery = z.infer<typeof FindingsQuerySchema>;

// ─── Manual Match (POST /admin/api/cossec/match) ───────────────────────────

export const ManualMatchBodySchema = z.object({
  institutionName: z.string().min(1).max(500),
  prospectInstitutionId: z.string().min(1),
});
export type ManualMatchBody = z.infer<typeof ManualMatchBodySchema>;

// ─── Category Stats ────────────────────────────────────────────────────────

export interface CategoryStats {
  category: string;
  total: number;
  bySeverity: Record<string, number>;
  institutions: number;
}

// ─── Exam Year Summary ─────────────────────────────────────────────────────

export interface ExamYearSummary {
  examYear: number;
  totalFindings: number;
  institutionsExamined: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
}

// ─── Sample Report ─────────────────────────────────────────────────────────

export interface SampleReportResult {
  prospectInstitutionId: string;
  reportUrl: string;
  generatedAt: string;
  pageCount: number;
}

export interface BatchGenerationResult {
  total: number;
  generated: number;
  failed: number;
  skipped: number;
  errors: { id: string; error: string }[];
}

// ─── Queue Status ──────────────────────────────────────────────────────────

export interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

// ─── Generate Single Report Body ───────────────────────────────────────────

export const GenerateSingleReportParamsSchema = z.object({
  prospectInstitutionId: z.string().min(1),
});

// ─── Preview Token Query ───────────────────────────────────────────────────

export const PreviewTokenQuerySchema = z.object({
  token: z.string().min(1),
});
export type PreviewTokenQuery = z.infer<typeof PreviewTokenQuerySchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const err = new Error('input invalid') as Error & { issues: unknown };
    err.issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw err;
  }
  return result.data;
}
