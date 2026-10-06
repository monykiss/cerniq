import { z } from 'zod';

// ─── NCUA Integration DTOs ──────────────────────────────────────────────────
// Zod-first validation schemas for the NCUA Form 5300 import API.

// ─── Import ─────────────────────────────────────────────────────────────────

export const ImportBodySchema = z.object({
  charterNumber: z
    .string()
    .min(1)
    .max(10)
    .regex(/^\d+$/, 'Charter number must be numeric'),
  workspaceId: z.string().uuid(),
});
export type ImportBody = z.infer<typeof ImportBodySchema>;

// ─── Bulk Import ────────────────────────────────────────────────────────────

export const BulkImportBodySchema = z.object({
  charterNumbers: z
    .array(
      z
        .string()
        .min(1)
        .max(10)
        .regex(/^\d+$/, 'Charter number must be numeric'),
    )
    .min(1, 'At least one charter number required')
    .max(100, 'Maximum 100 credit unions per bulk import'),
  workspaceId: z.string().uuid(),
});
export type BulkImportBody = z.infer<typeof BulkImportBodySchema>;

// ─── Search ─────────────────────────────────────────────────────────────────

export const SearchQuerySchema = z.object({
  name: z.string().min(1).max(200),
  state: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, 'State must be a 2-letter code (e.g. PR, FL)')
    .optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ─── Sync ───────────────────────────────────────────────────────────────────

export const SyncParamSchema = z.object({
  institutionId: z.string().min(1),
});
export type SyncParam = z.infer<typeof SyncParamSchema>;

// ─── Quarter format ─────────────────────────────────────────────────────────

export const QuarterSchema = z
  .string()
  .regex(/^\d{4}-Q[1-4]$/, 'Quarter must be in YYYY-QN format (e.g. 2025-Q4)');

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
