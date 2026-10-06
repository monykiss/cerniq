import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 09 — Loan Pricing Agent.
// Mirrors Vol.1 Bible §09. Risk-adjusted pricing: FTP + CECL + capital.

export const LoanPricingTier = z.enum(['MINIMUM', 'TARGET', 'PREMIUM']);

export const PricingComponentSchema = z.object({
  component: z.enum([
    'FTP_BASE',
    'CREDIT_SPREAD',
    'CECL_CAPITAL_CHARGE',
    'OPERATING_COST',
    'LIQUIDITY_PREMIUM',
    'PROFIT_MARGIN',
  ]),
  bps: z.number().int(),
  rationale: z.string().min(1),
});

export const PricingOptionSchema = z.object({
  tier: LoanPricingTier,
  rate: z.number(),
  rateBps: z.number().int(),
  annualRevenue: z.number(),
  components: z.array(PricingComponentSchema),
});

export const LoanPricingOutputSchema = z
  .object({
    agentId: z.literal('loan_pricing'),
    version: z.literal('1.0'),
    runId: z.string().min(1),
    institutionId: z.string().min(1),
    timestamp: IsoTimestampSchema,
    language: LanguageSchema,
    loanParams: z.object({
      amount: z.number().positive(),
      termMonths: z.number().int().positive(),
      sector: z.string().min(1),
      riskGrade: z.string().min(1),
    }),
    concentrationCheck: z.object({
      sectorCurrentPct: z.number(),
      sectorLimit: z.number(),
      nearLimit: z.boolean(),
      premiumApplied: z.boolean(),
      premiumBps: z.number().int().nonnegative(),
    }),
    pricingOptions: z.tuple([
      PricingOptionSchema,
      PricingOptionSchema,
      PricingOptionSchema,
    ]),
    peerAverage: z.object({
      rate: z.number(),
      source: z.string(),
    }),
    recommendation: z.object({
      tier: LoanPricingTier,
      rate: z.number(),
      rationale: z.string().min(1),
      rationaleEs: z.string().min(1),
    }),
    auditTraceId: z.string().min(1),
  })
  .refine(
    (out) => {
      const min = out.pricingOptions[0];
      return min.tier === 'MINIMUM';
    },
    { message: 'first pricing option must be MINIMUM tier' },
  );
export type LoanPricingOutput = z.infer<typeof LoanPricingOutputSchema>;
