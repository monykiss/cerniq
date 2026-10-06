import type { ZodType } from 'zod';
import type { AgentType } from './contracts';
import {
  ALMDecisionOutputSchema,
  CommitteeReportOutputSchema,
  RiskMonitorOutputSchema,
  CFOCopilotOutputSchema,
  StressTestOutputSchema,
  CapitalOptimizerOutputSchema,
  RegulatoryComplianceOutputSchema,
  ExamPrepOutputSchema,
  LoanPricingOutputSchema,
  DepositStrategyOutputSchema,
  PeerIntelligenceOutputSchema,
  BoardNarrativeOutputSchema,
} from '../agents/contracts';

/**
 * Maps AgentType → Zod output schema. Single source of truth for which schema
 * the trust layer validates against, which the eval harness scores against,
 * and which the replay runner uses.
 *
 * New agent? Add a row here and the type system forces the rest.
 */
const REGISTRY: Record<AgentType, ZodType> = {
  ALM_DECISION: ALMDecisionOutputSchema,
  COMMITTEE_REPORT: CommitteeReportOutputSchema,
  RISK_MONITOR: RiskMonitorOutputSchema,
  CFO_COPILOT: CFOCopilotOutputSchema,
  STRESS_TESTING: StressTestOutputSchema,
  CAPITAL_OPTIMIZER: CapitalOptimizerOutputSchema,
  REGULATORY_COMPLIANCE: RegulatoryComplianceOutputSchema,
  EXAM_PREP: ExamPrepOutputSchema,
  LOAN_PRICING: LoanPricingOutputSchema,
  DEPOSIT_STRATEGY: DepositStrategyOutputSchema,
  PEER_INTELLIGENCE: PeerIntelligenceOutputSchema,
  BOARD_NARRATIVE: BoardNarrativeOutputSchema,
};

export function getOutputSchema(agentType: AgentType): ZodType {
  const schema = REGISTRY[agentType];
  if (!schema)
    throw new Error(`No output schema registered for agent type: ${agentType}`);
  return schema;
}

export function hasOutputSchema(agentType: AgentType): boolean {
  return agentType in REGISTRY;
}
