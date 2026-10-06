import type { AgentId } from '@prisma/client';
import { AlmDecisionAgent } from './alm-decision.definition';
import { CommitteeReportAgent } from './committee-report.definition';
import { RiskMonitorAgent } from './risk-monitor.definition';
import { CFOCopilotAgent } from './cfo-copilot.definition';
import { StressTestingAgent } from './stress-testing.definition';
import { CapitalOptimizerAgent } from './capital-optimizer.definition';
import { RegulatoryComplianceAgent } from './regulatory-compliance.definition';
import { ExamPrepAgent } from './exam-prep.definition';
import { LoanPricingAgent } from './loan-pricing.definition';
import { DepositStrategyAgent } from './deposit-strategy.definition';
import { PeerIntelligenceAgent } from './peer-intelligence.definition';
import { BoardNarrativeAgent } from './board-narrative.definition';
import type { AgentDefinition } from './agent.definition';

export const AGENT_DEFINITIONS: Partial<Record<AgentId, AgentDefinition>> = {
  ALM_DECISION: AlmDecisionAgent,
  COMMITTEE_REPORT: CommitteeReportAgent,
  RISK_MONITOR: RiskMonitorAgent,
  CFO_COPILOT: CFOCopilotAgent,
  STRESS_TESTING: StressTestingAgent,
  CAPITAL_OPTIMIZER: CapitalOptimizerAgent,
  REGULATORY_COMPLIANCE: RegulatoryComplianceAgent,
  EXAM_PREP: ExamPrepAgent,
  LOAN_PRICING: LoanPricingAgent,
  DEPOSIT_STRATEGY: DepositStrategyAgent,
  PEER_INTELLIGENCE: PeerIntelligenceAgent,
  BOARD_NARRATIVE: BoardNarrativeAgent,
};

export function resolveAgentDefinition(
  id: AgentId,
): AgentDefinition | undefined {
  return AGENT_DEFINITIONS[id];
}
