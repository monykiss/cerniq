/**
 * Model Registry types — FAANG Audit P1.
 *
 * These types drive the seeder, the service, and the controller.
 * They mirror the Prisma enums but live in plain TS so consuming
 * code never imports from @prisma/client directly (see prisma.service.ts quirk).
 */

export type ModelStatus =
  | 'DRAFT'
  | 'CANDIDATE'
  | 'APPROVED'
  | 'DEPRECATED'
  | 'RETIRED';

export type ModelCategory =
  | 'ALM_CORE'
  | 'CREDIT_RISK'
  | 'LIQUIDITY'
  | 'INTEREST_RATE'
  | 'STRESS_TEST'
  | 'CAPITAL'
  | 'REGULATORY'
  | 'PRICING'
  | 'RISK_METRICS'
  | 'REPORTING'
  | 'PEER_ANALYTICS'
  | 'PORTFOLIO';

export type ModelRiskTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface ModelSeedEntry {
  modelKey: string;
  displayName: string;
  description: string;
  version: string;
  category: ModelCategory;
  riskTier: ModelRiskTier;
  status: ModelStatus;
  ownerName: string;
  serviceFile: string;
  entryFunction: string;
  calibrationMetadata?: Record<string, unknown>;
  requiredInputs?: string[];
  limitations?: string[];
}

export interface ModelRegistryFilter {
  category?: ModelCategory;
  status?: ModelStatus;
  riskTier?: ModelRiskTier;
}

export interface ApproveModelInput {
  approvedBy: string;
}

export interface RetireModelInput {
  retiredBy: string;
  reason: string;
}
