import { z } from 'zod';

// ─── Market Data Schemas ─────────────────────────────────────

export const MarketRateResultSchema = z.object({
  dataType: z.string(),
  value: z.number(),
  previousValue: z.number().optional(),
  asOfDate: z.string(),
  source: z.string(),
});
export type MarketRateResult = z.infer<typeof MarketRateResultSchema>;

export const TreasuryCurvePointSchema = z.object({
  tenorMonths: z.number(),
  rate: z.number(),
});

export const TreasuryCurveResultSchema = z.object({
  points: z.array(TreasuryCurvePointSchema),
  asOfDate: z.string(),
});
export type TreasuryCurveResult = z.infer<typeof TreasuryCurveResultSchema>;

export const MarketDataSnapshotSchema = z.object({
  id: z.string().optional(),
  dataType: z.string(),
  value: z.number(),
  previousValue: z.number().nullable().optional(),
  asOfDate: z.string(),
  source: z.string(),
  createdAt: z.string().optional(),
});
export type MarketDataSnapshot = z.infer<typeof MarketDataSnapshotSchema>;

// ─── Rate Alert Schemas ──────────────────────────────────────

export const AlertDirection = z.enum(['ABOVE', 'BELOW']);
export type AlertDirection = z.infer<typeof AlertDirection>;

export const AlertLevel = z.enum(['WARN', 'BREACH']);
export type AlertLevel = z.infer<typeof AlertLevel>;

export const SetThresholdParamsSchema = z.object({
  metric: z.string().min(1),
  warnLevel: z.number(),
  breachLevel: z.number(),
  direction: AlertDirection,
  notifyEmail: z.boolean().optional().default(false),
  notifyWebhook: z.boolean().optional().default(false),
});
export type SetThresholdParams = z.input<typeof SetThresholdParamsSchema>;

export const RateAlertThresholdSchema = z.object({
  institutionId: z.string(),
  metric: z.string(),
  warnLevel: z.number(),
  breachLevel: z.number(),
  direction: AlertDirection,
  notifyEmail: z.boolean(),
  notifyWebhook: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type RateAlertThreshold = z.infer<typeof RateAlertThresholdSchema>;

export const RateAlertSchema = z.object({
  metric: z.string(),
  level: AlertLevel,
  currentValue: z.number(),
  threshold: z.number(),
  direction: AlertDirection,
  message: z.string(),
  messageEs: z.string(),
});
export type RateAlert = z.infer<typeof RateAlertSchema>;

// ─── Recalc Schemas ──────────────────────────────────────────

export const RecalcMetricsSchema = z.object({
  niiSensitivity: z.number(),
  eveChange: z.number(),
  durationGap: z.number(),
  lcr: z.number(),
});

export const RecalcResultSchema = z.object({
  institutionId: z.string(),
  metrics: RecalcMetricsSchema,
  previousMetrics: z.record(z.string(), z.number()),
  recalculatedAt: z.string(),
});
export type RecalcResult = z.infer<typeof RecalcResultSchema>;

// ─── WebSocket Event Schemas ─────────────────────────────────

export const SubscribePayloadSchema = z.object({
  institutionId: z.string().min(1),
});

export const RateUpdateEventSchema = z.object({
  dataType: z.string(),
  value: z.number(),
  previousValue: z.number(),
  changePercent: z.number(),
  asOfDate: z.string(),
});

export const AlmRecalcEventSchema = z.object({
  institutionId: z.string(),
  metric: z.string(),
  newValue: z.number(),
  previousValue: z.number(),
  delta: z.number(),
});

export const AlertEventSchema = z.object({
  institutionId: z.string(),
  metric: z.string(),
  level: AlertLevel,
  currentValue: z.number(),
  threshold: z.number(),
  message: z.string(),
  messageEs: z.string(),
});

export const ConnectionStatusEventSchema = z.object({
  status: z.enum(['connected', 'reconnecting']),
  feedsActive: z.array(z.string()),
});

// ─── REST Request Schemas ────────────────────────────────────

export const HistoryQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const SetThresholdBodySchema = SetThresholdParamsSchema;
