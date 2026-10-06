import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const golden017RiskAdjustedPricing: GoldenCase = {
  id: 'golden-017',
  name: 'Risk-adjusted loan pricing: $2M commercial, high concentration sector',
  agentType: 'LOAN_PRICING',
  params: {
    institutionId: 'golden-017',
    loanAmount: 2_000_000,
    termMonths: 60,
    sector: 'commercial_real_estate',
    riskGrade: 'B+',
  },
  expected: {
    topRiskDomain: 'Credit Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [55, 80],
    hasRegulatoryReference: true,
    toolsCalledMin: 4,
    bilingualRequired: true,
    maxWords: 400,
    requiredRegulatoryCodes: ['12 CFR 723'],
  },
};
