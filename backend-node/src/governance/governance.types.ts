/**
 * Governance entity types — FAANG Audit P1 items #2 and #3.
 *
 * Shared lifecycle + entity-specific types for governed scenarios
 * and governed benchmarks.
 */

export type GovernedEntityStatus =
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'SUPERSEDED'
  | 'RETIRED';
export type ScenarioScope = 'INSTITUTION' | 'SECTOR' | 'REGULATORY';
export type BenchmarkType =
  | 'YIELD_CURVE'
  | 'PEER_BENCHMARK'
  | 'REGULATORY_LIMIT'
  | 'MARKET_INDEX';
export type RefreshPolicy =
  | 'MANUAL'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'ON_PUBLICATION';

export interface GovernedScenarioSeed {
  scenarioKey: string;
  displayName: string;
  description: string;
  version: string;
  scope: ScenarioScope;
  status: GovernedEntityStatus;
  source: string;
  ownerName: string;
  parameters: Record<string, unknown>;
  approvedUses?: string[];
  provenance?: Record<string, unknown>;
}

export interface GovernedBenchmarkSeed {
  datasetKey: string;
  displayName: string;
  description: string;
  benchmarkType: BenchmarkType;
  version: string;
  status: GovernedEntityStatus;
  asOfDate: Date;
  source: string;
  ownerName: string;
  refreshPolicy: RefreshPolicy;
  data: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  fallbackPolicy?: string;
}

export interface GovernanceFilter {
  status?: GovernedEntityStatus;
}

export interface ScenarioFilter extends GovernanceFilter {
  scope?: ScenarioScope;
}

export interface BenchmarkFilter extends GovernanceFilter {
  benchmarkType?: BenchmarkType;
}
