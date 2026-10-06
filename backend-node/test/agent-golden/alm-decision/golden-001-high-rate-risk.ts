import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Vol3 §Agent Eval Framework — reference case #1.
 *
 * Hypothetical PR cooperativa mid-2026, high duration mismatch, LCR above
 * threshold, CAMEL composite deteriorating. The ALM Decision Agent should
 * surface Interest Rate Risk as the top domain with a quantified NII impact
 * at +200bps and a reg reference (12 CFR 741.3 — IRR policy).
 *
 * This fixture is intentionally input-only — the actual balance sheet seed
 * data lives in the seed pipeline and is referenced by `params.balanceSheetId`.
 * Keeping fixtures as code means type-check catches schema drift at build time.
 */
export const golden001HighRateRisk: GoldenCase = {
  id: 'golden-001',
  name: 'High rate risk, adequate liquidity (PR cooperativa, mid-cycle)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-001',
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [50, 70],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['12 CFR 741.3'],
  },
};
