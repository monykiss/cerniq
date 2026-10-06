import { z } from 'zod';
import { IsoTimestampSchema, LanguageSchema } from './common.contracts';

// Output schema for Agent 11 — Peer Intelligence Agent.
// Mirrors Vol.1 Bible §11. Weekly competitive benchmarking digest.

export const QuartileSchema = z.enum(['Q1', 'Q2', 'Q3', 'Q4']);
export const TrendSchema = z.enum(['improving', 'stable', 'deteriorating']);

export const PeerMetricSchema = z.object({
  metric: z.string().min(1),
  category: z.enum([
    'PROFITABILITY',
    'CAPITAL',
    'ASSET_QUALITY',
    'LIQUIDITY',
    'GROWTH',
    'PRICING',
  ]),
  institutionValue: z.number(),
  peerMedian: z.number(),
  gapBps: z.number().int(),
  quartile: QuartileSchema,
  priorQuartile: QuartileSchema.optional(),
  trend: TrendSchema,
});

export const CompetitiveGapSchema = z.object({
  metric: z.string().min(1),
  institutionValue: z.number(),
  peerMedian: z.number(),
  gapBps: z.number().int(),
  dollarImpactOfClosing: z.number(),
  recommendation: z.string().min(1),
  recommendationEs: z.string().min(1),
});

export const PeerIntelligenceOutputSchema = z.object({
  agentId: z.literal('peer_intelligence'),
  version: z.literal('1.0'),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  timestamp: IsoTimestampSchema,
  language: LanguageSchema,
  peerCohort: z.object({
    description: z.string().min(1),
    count: z.number().int().positive(),
    assetRange: z.object({
      minMillions: z.number().positive(),
      maxMillions: z.number().positive(),
    }),
  }),
  performanceOverview: z.array(PeerMetricSchema).min(6),
  wins: z.array(
    z.object({
      metric: z.string().min(1),
      movement: z.string().min(1),
    }),
  ),
  urgentGaps: z.array(
    z.object({
      metric: z.string().min(1),
      movement: z.string().min(1),
    }),
  ),
  competitiveGaps: z.array(CompetitiveGapSchema),
  marketIntelligence: z.object({
    rateEnvironment: z.string().min(1),
    peerCdSpecials: z.string().optional(),
    notablePeerMoves: z.array(z.string()),
  }),
  quarterlyRanking: z.array(PeerMetricSchema),
  summary: z.string().min(1),
  summaryEs: z.string().min(1),
  auditTraceId: z.string().min(1),
});
export type PeerIntelligenceOutput = z.infer<
  typeof PeerIntelligenceOutputSchema
>;
