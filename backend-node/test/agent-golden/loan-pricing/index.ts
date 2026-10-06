export { golden017RiskAdjustedPricing } from './golden-017-risk-adjusted-pricing';

import { golden017RiskAdjustedPricing } from './golden-017-risk-adjusted-pricing';

import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const LOAN_PRICING_GOLDENS: readonly GoldenCase[] = [
  golden017RiskAdjustedPricing,
];
