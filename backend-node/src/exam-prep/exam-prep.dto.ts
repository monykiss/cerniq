import { z } from 'zod';

// ─── Exam Prep Suite DTOs ───────────────────────────────────────────────────
// Zod-first validation schemas for the COSSEC Exam Prep readiness scoring API.

// ─── Institution ID Param ───────────────────────────────────────────────────

export const InstitutionIdParamSchema = z.object({
  institutionId: z.string().min(1),
});
export type InstitutionIdParam = z.infer<typeof InstitutionIdParamSchema>;

// ─── Assess Body ────────────────────────────────────────────────────────────

export const AssessBodySchema = z.object({
  assessedBy: z.string().min(1).max(200).optional().default('system'),
  language: z.enum(['en', 'es', 'bilingual']).default('bilingual'),
  includeRemediation: z.boolean().default(true),
});
export type AssessBody = z.infer<typeof AssessBodySchema>;

// ─── Evidence Package Body ──────────────────────────────────────────────────

export const EvidencePackageBodySchema = z.object({
  format: z.enum(['ZIP', 'PDF']).default('ZIP'),
  language: z.enum(['en', 'es', 'bilingual']).default('bilingual'),
  includeTemplates: z.boolean().default(true),
});
export type EvidencePackageBody = z.infer<typeof EvidencePackageBodySchema>;

// ─── Assessment History Query ───────────────────────────────────────────────

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

// ─── Shared parse helper ────────────────────────────────────────────────────

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
