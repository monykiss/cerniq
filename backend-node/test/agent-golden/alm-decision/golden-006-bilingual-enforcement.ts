import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Vol3 Failure taxonomy "Missing bilingual" + Vol2 §Regression Scoring
 * (Bilingual Completeness 10% weight).
 *
 * PR cooperativa where agent is expected to produce bilingual output. If the
 * agent only returns English, the eval harness should score Bilingual
 * Completeness at 0-50% depending on coverage, dragging total score. Trust
 * layer fires MISSING_BILINGUAL BLOCK.
 */
export const golden006BilingualEnforcement: GoldenCase = {
  id: 'golden-006',
  name: 'Bilingual enforcement (PR cooperativa, both EN + ES mandatory)',
  agentType: 'ALM_DECISION',
  params: {
    balanceSheetId: 'golden-006',
    language: 'bilingual',
  },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    requiredRegulatoryCodes: ['12 CFR 741.3', 'COSSEC Reg. 8935'],
  },
};
