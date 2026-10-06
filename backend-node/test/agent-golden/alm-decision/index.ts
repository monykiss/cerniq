export { golden001HighRateRisk } from './golden-001-high-rate-risk';
export { golden002LiquidityStress } from './golden-002-liquidity-stress';
export { golden003HealthyBaseline } from './golden-003-healthy-baseline';
export { golden004CreditConcentration } from './golden-004-credit-concentration';
export { golden005CapitalAdequacy } from './golden-005-capital-adequacy';
export { golden006BilingualEnforcement } from './golden-006-bilingual-enforcement';
export { golden007MultiRiskConcurrent } from './golden-007-multi-risk-concurrent';
export { golden008GracefulDegradation } from './golden-008-graceful-degradation';

import { golden001HighRateRisk } from './golden-001-high-rate-risk';
import { golden002LiquidityStress } from './golden-002-liquidity-stress';
import { golden003HealthyBaseline } from './golden-003-healthy-baseline';
import { golden004CreditConcentration } from './golden-004-credit-concentration';
import { golden005CapitalAdequacy } from './golden-005-capital-adequacy';
import { golden006BilingualEnforcement } from './golden-006-bilingual-enforcement';
import { golden007MultiRiskConcurrent } from './golden-007-multi-risk-concurrent';
import { golden008GracefulDegradation } from './golden-008-graceful-degradation';

import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const ALM_DECISION_GOLDENS: readonly GoldenCase[] = [
  golden001HighRateRisk,
  golden002LiquidityStress,
  golden003HealthyBaseline,
  golden004CreditConcentration,
  golden005CapitalAdequacy,
  golden006BilingualEnforcement,
  golden007MultiRiskConcurrent,
  golden008GracefulDegradation,
];
