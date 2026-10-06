import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────

export const LanguageSchema = z.enum(['en', 'es', 'bilingual']);
export type Language = z.infer<typeof LanguageSchema>;

export const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof SeveritySchema>;

export const DeadlineSchema = z.enum(['30d', '60d', '90d']);
export type Deadline = z.infer<typeof DeadlineSchema>;

export const OwnerSchema = z.enum(['CFO', 'ALM_COMMITTEE', 'BOARD']);
export type Owner = z.infer<typeof OwnerSchema>;

export const CommitteeTypeSchema = z.enum([
  'board',
  'alm',
  'supervisory',
  'regulator',
]);
export type CommitteeType = z.infer<typeof CommitteeTypeSchema>;

// A Zod-friendly ISO-8601 timestamp. We don't use `z.string().datetime()` here
// because Prisma serialises Date objects to strings that include fractional
// seconds and timezone offsets which the spec allows but the stricter mode
// rejects. A RFC-3339-ish regex is sufficient and version-stable.
export const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'must be ISO-8601',
  );

export const UuidSchema = z.string().uuid();

// Bilingual string pair (EN + ES). Both required when the agent's language
// is "bilingual"; validation happens at the agent contract level.
export const BilingualStringSchema = z.object({
  en: z.string().min(1),
  es: z.string().min(1),
});
export type BilingualString = z.infer<typeof BilingualStringSchema>;

// Envelope returned by every tool handler. Discriminated union so TS narrows
// correctly after checking `ok`.
export const ToolOkSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
    /// Which quantitative models produced this result. Powers the Bible's
    /// "Each finding references specific tool" evaluation criterion.
    provenance: z.array(z.string()).default([]),
    durationMs: z.number().int().nonnegative(),
  });

export const ToolErrorSchema = z.object({
  ok: z.literal(false),
  /// Machine-readable error code — stable across releases for retry logic.
  code: z.enum([
    'TOOL_TIMEOUT',
    'TOOL_UNAVAILABLE',
    'TOOL_INPUT_INVALID',
    'TOOL_OUTPUT_INVALID',
    'TOOL_DEPENDENCY_FAILED',
    'TOOL_INTERNAL_ERROR',
  ]),
  message: z.string(),
  /// Human-safe details. MUST NOT contain PII or raw exception stacks.
  hint: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const ToolResultSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion('ok', [ToolOkSchema(data), ToolErrorSchema]);
