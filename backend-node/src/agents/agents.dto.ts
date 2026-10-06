import { z } from 'zod';

// Request DTOs validated at the HTTP boundary with Zod (consistent with the
// agents module's internal pattern). We intentionally do not use
// `class-validator` decorators here — Zod-first keeps input validation
// co-located with the schemas the runtime is already enforcing downstream.

export const RunAgentRequestSchema = z.object({
  agentId: z.enum([
    'ALM_DECISION',
    'COMMITTEE_REPORT',
    'RISK_MONITOR',
    'CFO_COPILOT',
    'STRESS_TESTING',
    'CAPITAL_OPTIMIZER',
    'REGULATORY_COMPLIANCE',
    'EXAM_PREP',
    'LOAN_PRICING',
    'DEPOSIT_STRATEGY',
    'PEER_INTELLIGENCE',
    'BOARD_NARRATIVE',
  ]),
  institutionId: z.string().min(1).optional(),
  organizationId: z.string().uuid().optional(),
  triggerKind: z
    .enum(['UPLOAD', 'SCHEDULE', 'USER_QUERY', 'API', 'CHAIN'])
    .default('API'),
  triggerRef: z.string().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  input: z.unknown().default({}),
});

export type RunAgentRequest = z.infer<typeof RunAgentRequestSchema>;

export const RunIdParamSchema = z.object({
  runId: z.string().min(1),
});
