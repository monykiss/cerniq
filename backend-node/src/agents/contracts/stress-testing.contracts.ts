import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 05 — Stress Testing Agent.
// Mirrors Vol.1 Bible §05 output spec. COSSEC + PR-specific scenarios.

export const ScenarioClassification = z.enum(['PASS', 'WARN', 'FAIL']);
export type ScenarioClassification = z.infer<typeof ScenarioClassification>;

export const StressScenarioResultSchema = z
  .object({
    scenarioId: z.string().min(1),
    name: z.string().min(1),
    rateShiftBps: z.number().int(),
    depositShockPct: z.number(),
    creditShockPct: z.number(),
    prExclusive: z.boolean(),
    niiImpact: z.number(),
    niiImpactPct: z.number(),
    eveImpact: z.number(),
    eveImpactPct: z.number(),
    depositImpact: z.number().optional(),
    creditLossImpact: z.number().optional(),
    totalImpact: z.number(),
    classification: ScenarioClassification,
    mitigation: z.string().optional(),
    mitigationEs: z.string().optional(),
  })
  .refine(
    (s) =>
      s.classification === 'PASS' || (s.mitigation && s.mitigation.length > 0),
    {
      message: 'WARN/FAIL scenarios must include mitigation',
      path: ['mitigation'],
    },
  );

export const StressTestOutputSchema = z.object({
  agentId: z.literal('stress_testing'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  scenarios: z.array(StressScenarioResultSchema).min(6),
  worstCase: z
    .object({
      scenarioId: z.string().min(1),
      totalImpact: z.number(),
      classification: ScenarioClassification,
      actionPlan: z.string().optional(),
      actionPlanEs: z.string().optional(),
    })
    .refine(
      (w) =>
        w.classification !== 'FAIL' ||
        (w.actionPlan && w.actionPlan.length > 0),
      {
        message: 'FAIL worst-case must include actionPlan',
        path: ['actionPlan'],
      },
    ),
  summary: z.string().min(1),
  summaryEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type StressTestOutput = z.infer<typeof StressTestOutputSchema>;

export const COSSEC_SCENARIO_IDS = [
  'parallel_up_100',
  'parallel_up_200',
  'parallel_up_300',
  'parallel_down_100',
  'parallel_down_200',
  'steepening_200',
  'flattening_200',
  'inversion_150',
  'pr_hurricane_scenario',
  'pr_recession_scenario',
  'pr_liquidity_crisis',
] as const;
