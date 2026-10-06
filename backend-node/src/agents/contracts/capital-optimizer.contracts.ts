import { z } from 'zod';
import {
  IsoTimestampSchema,
  LanguageSchema,
  DeadlineSchema,
} from './common.contracts';

// Output schema for Agent 06 — Capital Optimizer Agent.
// Mirrors Vol.1 Bible §06. Maximizes NIM within hard+soft constraints.

export const ConstraintStatus = z.enum(['PASS', 'FAIL']);

export const BalanceSheetLineSchema = z.object({
  category: z.string().min(1),
  balance: z.number(),
  yield: z.number(),
  duration: z.number(),
});

export const ReallocationMoveSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  amount: z.number().positive(),
  timeline: DeadlineSchema,
  nimImpactBps: z.number(),
  nimImpactDollars: z.number(),
  rationale: z.string().min(1),
});

export const ConstraintCheckSchema = z.object({
  name: z.string().min(1),
  threshold: z.number(),
  currentValue: z.number(),
  optimizedValue: z.number(),
  status: ConstraintStatus,
});

export const CapitalOptimizerOutputSchema = z.object({
  agentId: z.literal('capital_optimizer'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  currentState: z.array(BalanceSheetLineSchema).min(1),
  optimizedState: z.array(BalanceSheetLineSchema).min(1),
  moves: z.array(ReallocationMoveSchema).min(1),
  constraints: z.object({
    hard: z.array(ConstraintCheckSchema),
    soft: z.array(ConstraintCheckSchema),
  }),
  nimImprovement: z.object({
    bps: z.number(),
    annualizedDollars: z.number().min(50_000),
  }),
  implementationSequence: z.array(
    z.object({
      order: z.number().int().positive(),
      moveIndex: z.number().int().nonnegative(),
      dependency: z.string().optional(),
    }),
  ),
  summary: z.string().min(1),
  summaryEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type CapitalOptimizerOutput = z.infer<
  typeof CapitalOptimizerOutputSchema
>;
