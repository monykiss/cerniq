import type { GoldenCase } from '../../../src/agent-eval/contracts';

// 10 golden test cases for ALM Decision Agent (Vol.2 §Agent Evaluation).
// Each case represents a distinct risk profile; together they cover the
// six scoring dimensions (tool coverage, dollar quantification, specificity,
// regulatory reference, bilingual completeness, format compliance).
//
// balanceSheetId values reference fixtures in test/golden/ or seeded demo data.
// If a fixture doesn't exist yet, the golden-runner skips with a data-gap warning.

export const ALM_DECISION_GOLDEN_CASES: readonly GoldenCase[] = [
  {
    id: 'golden-001',
    name: 'High rate risk, adequate liquidity',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-001',
      institutionId: 'test-pr-001',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      topRiskDomain: 'Interest Rate Risk',
      hasMinDollarQuantification: true,
      healthScoreRange: [50, 70],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
      maxWords: 600,
      requiredRegulatoryCodes: ['COSSEC'],
    },
  },
  {
    id: 'golden-002',
    name: 'Liquidity stress, capital erosion',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-002',
      institutionId: 'test-pr-002',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      topRiskDomain: 'Liquidity Risk',
      hasMinDollarQuantification: true,
      healthScoreRange: [30, 55],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
      maxWords: 600,
    },
  },
  {
    id: 'golden-003',
    name: 'Capital near regulatory minimum',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-003',
      institutionId: 'test-pr-003',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      topRiskDomain: 'Capital Risk',
      hasMinDollarQuantification: true,
      healthScoreRange: [25, 50],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
      requiredRegulatoryCodes: ['NCUA', 'COSSEC'],
    },
  },
  {
    id: 'golden-004',
    name: 'Concentration risk — single sector >20%',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-004',
      institutionId: 'test-pr-004',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      topRiskDomain: 'Concentration Risk',
      hasMinDollarQuantification: true,
      healthScoreRange: [45, 65],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
    },
  },
  {
    id: 'golden-005',
    name: 'Healthy baseline — all metrics within limits',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-005',
      institutionId: 'test-pr-005',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      hasMinDollarQuantification: true,
      healthScoreRange: [75, 100],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
      maxWords: 600,
    },
  },
  {
    id: 'golden-006',
    name: 'USVI institution — English only, no bilingual',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-006',
      institutionId: 'test-usvi-001',
      region: 'USVI',
      language: 'en',
    },
    expected: {
      hasMinDollarQuantification: true,
      healthScoreRange: [50, 80],
      toolsCalledMin: 6,
      bilingualRequired: false,
      maxWords: 600,
    },
  },
  {
    id: 'golden-007',
    name: 'Credit quality deterioration — CECL coverage below threshold',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-007',
      institutionId: 'test-pr-007',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      topRiskDomain: 'Credit Risk',
      hasMinDollarQuantification: true,
      healthScoreRange: [35, 60],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
    },
  },
  {
    id: 'golden-008',
    name: 'Deposit outflow anomaly — EWS triggers',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-008',
      institutionId: 'test-pr-008',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      hasMinDollarQuantification: true,
      healthScoreRange: [30, 55],
      hasRegulatoryReference: true,
      toolsCalledMin: 8,
      bilingualRequired: true,
    },
  },
  {
    id: 'golden-009',
    name: 'Multiple compounding risks — rate + liquidity + concentration',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-009',
      institutionId: 'test-pr-009',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      hasMinDollarQuantification: true,
      healthScoreRange: [20, 45],
      hasRegulatoryReference: true,
      toolsCalledMin: 8,
      bilingualRequired: true,
      requiredRegulatoryCodes: ['COSSEC'],
    },
  },
  {
    id: 'golden-010',
    name: 'Post-hurricane recovery — improving trend from distressed state',
    agentType: 'ALM_DECISION',
    params: {
      balanceSheetId: 'golden-010',
      institutionId: 'test-pr-010',
      region: 'PR',
      language: 'bilingual',
    },
    expected: {
      hasMinDollarQuantification: true,
      healthScoreRange: [40, 65],
      hasRegulatoryReference: true,
      toolsCalledMin: 6,
      bilingualRequired: true,
      requiredRegulatoryCodes: ['COSSEC'],
    },
  },
] as const;
