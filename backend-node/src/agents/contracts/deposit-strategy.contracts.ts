import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 10 — Deposit Strategy Agent.
// Mirrors Vol.1 Bible §10. Deposit mix optimization + repricing.

export const DepositProductSchema = z.object({
  product: z.string().min(1),
  balance: z.number().nonnegative(),
  mixPct: z.number().min(0).max(100),
  costBps: z.number().int(),
  beta: z.number().min(0).max(1),
  decayRate: z.number().min(0).max(1),
  avgMaturityMonths: z.number().nonnegative().optional(),
});

export const RepricingRecommendationSchema = z.object({
  product: z.string().min(1),
  action: z.enum(['RAISE', 'CUT', 'HOLD']),
  currentRateBps: z.number().int(),
  recommendedRateBps: z.number().int(),
  peerRateBps: z.number().int(),
  rationale: z.string().min(1),
  rationaleEs: z.string().min(1),
});

export const MaturityCliffSchema = z.object({
  month: z.string().min(1),
  maturingAmount: z.number().positive(),
  maturingPct: z.number().min(0).max(100),
  renewalStrategy: z.string().min(1),
});

export const DepositStrategyOutputSchema = z.object({
  agentId: z.literal('deposit_strategy'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  currentState: z.object({
    products: z.array(DepositProductSchema).min(1),
    weightedAvgCostBps: z.number().int(),
    weightedAvgMaturityMonths: z.number().nonnegative(),
    totalDeposits: z.number().positive(),
  }),
  repricingRecommendations: z.array(RepricingRecommendationSchema),
  mixOptimization: z.object({
    targetMix: z.array(
      z.object({
        product: z.string().min(1),
        currentPct: z.number(),
        targetPct: z.number(),
        rationale: z.string().min(1),
      }),
    ),
    expectedCostReductionBps: z.number().int(),
    timelineMonths: z.number().int().positive(),
  }),
  maturityCliffs: z.array(MaturityCliffSchema),
  summary: z.string().min(1),
  summaryEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type DepositStrategyOutput = z.infer<typeof DepositStrategyOutputSchema>;
