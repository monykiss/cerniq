import { z } from 'zod';

// ─── Enterprise API DTOs ────────────────────────────────────────────────────
// Zod-first validation schemas for the Enterprise tier bulk report API.
// Consistent with the agents module pattern — no class-validator decorators.

// ─── Create Batch ───────────────────────────────────────────────────────────

export const CreateBatchBodySchema = z.object({
  organizationId: z.string().uuid(),
  batchType: z.enum(['BULK_REPORT', 'CUSTOM_ANALYSIS', 'SCHEDULED']),
  priority: z.enum(['NORMAL', 'HIGH']).default('NORMAL'),
  institutionIds: z
    .array(z.string().min(1))
    .min(1, 'At least one institution required')
    .max(500, 'Maximum 500 institutions per batch'),
  modules: z
    .array(z.string().min(1))
    .optional()
    .describe('ALM modules to include; omit for full report'),
  outputFormat: z.enum(['PDF', 'JSON', 'XLSX']).default('PDF'),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z
    .string()
    .min(16, 'Webhook secret must be at least 16 characters')
    .optional(),
});
export type CreateBatchBody = z.infer<typeof CreateBatchBodySchema>;

// ─── Batch ID Param ─────────────────────────────────────────────────────────

export const BatchIdParamSchema = z.object({
  batchId: z.string().uuid(),
});
export type BatchIdParam = z.infer<typeof BatchIdParamSchema>;

// ─── List Batches Query ─────────────────────────────────────────────────────

export const ListBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'PARTIAL',
    ])
    .optional(),
});
export type ListBatchesQuery = z.infer<typeof ListBatchesQuerySchema>;

// ─── Webhook Delivery Log Query ─────────────────────────────────────────────

export const WebhookLogQuerySchema = z.object({
  batchId: z.string().uuid(),
});
export type WebhookLogQuery = z.infer<typeof WebhookLogQuerySchema>;

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
