import { z } from 'zod';
import { SeveritySchema } from './common.contracts';

// Output schema for Agent 03 — Risk Monitoring Agent.
// The agent's entire output is a JSON array. Empty array == "silence is
// signal" (Bible §03). An empty run is a successful run.

export const RiskAlertSchema = z.object({
  category: z.enum([
    'liquidity',
    'rate_risk',
    'capital',
    'credit',
    'concentration',
    'deposit_flows',
    'peer_standing',
    'camel_drift',
  ]),
  severity: SeveritySchema,
  metric: z.string().min(1),
  currentValue: z.number(),
  threshold: z.number(),
  /// current - threshold. Negative means breach.
  delta: z.number(),
  trend: z.enum(['worsening', 'stable', 'improving']),
  finding: z.string().min(1),
  findingEs: z.string().min(1),
  recommendation: z.string().min(1),
  regulatoryRef: z.string().min(1),
  /// ISO-8601 date, not timestamp. Examiners want day-granular deadlines.
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /// Stable hash base — the service layer computes sha256 over this
  /// string concat with institutionId to form the dedup key.
  dedupSeed: z.string().min(1),
});

export type RiskAlert = z.infer<typeof RiskAlertSchema>;

export const RiskMonitorOutputSchema = z.object({
  agentId: z.literal('risk_monitor'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  scanKind: z.enum(['daily', 'weekly', 'monthly', 'realtime']),
  alerts: z.array(RiskAlertSchema),
  /// Mirror of `alerts.length` for fast dashboard queries.
  alertCount: z.number().int().nonnegative(),
  /// Always true if no CRITICAL/HIGH alerts. Used by the scheduler to
  /// short-circuit notification fan-out on quiet scans.
  quietRun: z.boolean(),
});

export type RiskMonitorOutput = z.infer<typeof RiskMonitorOutputSchema>;
