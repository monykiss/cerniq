import { ALM_DECISION_GOLDENS } from './alm-decision';
import { CFO_COPILOT_GOLDENS } from './cfo-copilot';
import { COMMITTEE_REPORT_GOLDENS } from './committee-report';
import { RISK_MONITOR_GOLDENS } from './risk-monitor';
import { STRESS_TESTING_GOLDENS } from './stress-testing';
import { CAPITAL_OPTIMIZER_GOLDENS } from './capital-optimizer';
import { REGULATORY_COMPLIANCE_GOLDENS } from './regulatory-compliance';
import { EXAM_PREP_GOLDENS } from './exam-prep';
import { LOAN_PRICING_GOLDENS } from './loan-pricing';
import { DEPOSIT_STRATEGY_GOLDENS } from './deposit-strategy';
import { PEER_INTELLIGENCE_GOLDENS } from './peer-intelligence';
import { BOARD_NARRATIVE_GOLDENS } from './board-narrative';
import type { GoldenCase } from '../../src/agent-eval/contracts';

export { ALM_DECISION_GOLDENS } from './alm-decision';
export { CFO_COPILOT_GOLDENS } from './cfo-copilot';
export { COMMITTEE_REPORT_GOLDENS } from './committee-report';
export { RISK_MONITOR_GOLDENS } from './risk-monitor';
export { STRESS_TESTING_GOLDENS } from './stress-testing';
export { CAPITAL_OPTIMIZER_GOLDENS } from './capital-optimizer';
export { REGULATORY_COMPLIANCE_GOLDENS } from './regulatory-compliance';
export { EXAM_PREP_GOLDENS } from './exam-prep';
export { LOAN_PRICING_GOLDENS } from './loan-pricing';
export { DEPOSIT_STRATEGY_GOLDENS } from './deposit-strategy';
export { PEER_INTELLIGENCE_GOLDENS } from './peer-intelligence';
export { BOARD_NARRATIVE_GOLDENS } from './board-narrative';

export const ALL_GOLDEN_CASES: readonly GoldenCase[] = [
  ...ALM_DECISION_GOLDENS,
  ...CFO_COPILOT_GOLDENS,
  ...COMMITTEE_REPORT_GOLDENS,
  ...RISK_MONITOR_GOLDENS,
  ...STRESS_TESTING_GOLDENS,
  ...CAPITAL_OPTIMIZER_GOLDENS,
  ...REGULATORY_COMPLIANCE_GOLDENS,
  ...EXAM_PREP_GOLDENS,
  ...LOAN_PRICING_GOLDENS,
  ...DEPOSIT_STRATEGY_GOLDENS,
  ...PEER_INTELLIGENCE_GOLDENS,
  ...BOARD_NARRATIVE_GOLDENS,
];
