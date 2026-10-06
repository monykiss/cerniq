import { z } from 'zod';
import {
  AgentId,
  AgentRunStatus,
  AgentAlertSeverity,
  AgentAlertStatus,
} from '@prisma/client';

// Zod-first DTOs for the agent-api module, mirroring the convention
// established by `src/agents/agents.dto.ts`. We deliberately avoid
// class-validator here so the validation surface stays consistent with
// the agents module that already validates the same enum literals.

export const AgentIdEnum = z.nativeEnum(AgentId);
export const AgentRunStatusEnum = z.nativeEnum(AgentRunStatus);
export const AgentAlertSeverityEnum = z.nativeEnum(AgentAlertSeverity);
export const AgentAlertStatusEnum = z.nativeEnum(AgentAlertStatus);

// ─── List runs (GET /api/v1/agents/:institutionId/runs) ─────────────────

export const ListRunsQuerySchema = z.object({
  agentId: AgentIdEnum.optional(),
  status: AgentRunStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Keyset cursor — pass the `id` of the last item from the prior page.
  // Stable under inserts because we order by createdAt DESC tiebreaking on id.
  cursor: z.string().min(1).optional(),
  since: z.coerce.date().optional(),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

// ─── List alerts (GET /api/v1/agents/:institutionId/alerts) ─────────────

export const ListAlertsQuerySchema = z.object({
  severity: AgentAlertSeverityEnum.optional(),
  status: AgentAlertStatusEnum.optional().default(AgentAlertStatus.OPEN),
  agentId: AgentIdEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListAlertsQuery = z.infer<typeof ListAlertsQuerySchema>;

// ─── Acknowledge alert (PATCH /alerts/:alertId) ──────────────────────────

export const AckAlertBodySchema = z.object({
  // Free-form operator note recorded on the alert. Bounded to keep the
  // audit log row sane — anything longer should live in a linked artifact.
  note: z.string().max(1000).optional(),
  // Resolution kind — defaults to ACKNOWLEDGED so the common "I saw it,
  // working on it" path needs no body. RESOLVED stamps `resolvedAt`,
  // SUPPRESSED stops re-emission until the dedup key changes.
  resolution: z
    .enum(['ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED'])
    .default('ACKNOWLEDGED'),
});
export type AckAlertBody = z.infer<typeof AckAlertBodySchema>;

// ─── CFO Copilot (POST /api/v1/agents/:institutionId/copilot) ───────────

export const CopilotBodySchema = z.object({
  query: z.string().min(1).max(4000),
  // Conversation handle — caller persists across turns. Optional first turn.
  sessionId: z.string().uuid().optional(),
  language: z.enum(['en', 'es', 'bilingual']).default('en'),
});
export type CopilotBody = z.infer<typeof CopilotBodySchema>;

// ─── Cost summary (GET /api/v1/agents/:institutionId/cost) ──────────────

export const CostQuerySchema = z.object({
  // YYYY-MM. Defaults to the current month server-side.
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
    .optional(),
});
export type CostQuery = z.infer<typeof CostQuerySchema>;

// ─── Trace export (GET /runs/:runId/trace/export) ───────────────────────

export const ExportFormatSchema = z.enum(['json', 'pdf']).default('json');
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// ─── Stream resume (GET /api/v1/agents/:institutionId/stream) ───────────

export const StreamQuerySchema = z.object({
  // Filter to a single run if provided. Otherwise streams every event for
  // the institution — Activity Feed pattern.
  runId: z.string().min(1).optional(),
});
export type StreamQuery = z.infer<typeof StreamQuerySchema>;

// ─── Helpers used by controllers ─────────────────────────────────────────

export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Caller wraps in BadRequestException — we just produce the issue list.
    const err = new Error('input invalid') as Error & { issues: unknown };
    err.issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw err;
  }
  return result.data;
}
