/**
 * B6 — Exam Prep Agent Golden Test Cases
 *
 * 10 deterministic fixtures covering the full EXAM_PREP scoring space:
 * perfect institutions, threshold boundaries, multi-category failures,
 * critical capital breaches, first-time assessments, and improvement deltas.
 *
 * Each case carries expected grade/score bands, per-category PASS/WARN/FAIL
 * statuses, and must-include recommendation keywords. The spec runner
 * validates Zod schema compliance (ExamPrepOutputSchema) and asserts
 * grades and scores fall within the declared bands.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type CategoryStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ExamPrepGoldenCase {
  name: string;
  description: string;
  input: {
    institutionId: string;
    metrics: {
      durationGap?: number;
      niiSensitivityPct?: number;
      eveChangePct?: number;
      lcrPct?: number;
      netWorthRatioPct?: number;
      capitalAdequacyPct?: number;
      delinquencyRatePct?: number;
      roaPct?: number;
      efficiencyRatioPct?: number;
      managementScore?: number;
    };
    /** Previous exam data for improvement-tracking cases. */
    previousAssessment?: {
      overallGrade: string;
      overallScore: number;
    };
  };
  expectedOutput: {
    /** Allowed overall letter grades. */
    overallGradeOneOf: string[];
    /** Inclusive [min, max] overall numeric score (0-100). */
    overallScoreRange: [number, number];
    /** Per-category expected status. */
    categoryStatuses: Record<string, CategoryStatus>;
    /** Keywords that MUST appear in the recommendations array. */
    mustIncludeRecommendations: string[];
  };
  tags: string[];
}

// ─── Cases ─────────────────────────────────────────────────────────────────

export const EXAM_PREP_GOLDEN_CASES: readonly ExamPrepGoldenCase[] = [
  // ── 1. Perfect institution (all PASS) ────────────────────────────────────
  {
    name: 'Perfect institution — all categories PASS',
    description:
      'Model institution with all metrics well within safe thresholds: ' +
      'duration gap < 2yr, NII sensitivity < 10%, LCR > 150%, ' +
      'net worth > 10%, no delinquencies. Should receive Grade A ' +
      'with a score of 95+. Recommendations should be maintenance-focused.',
    input: {
      institutionId: 'ep-golden-001',
      metrics: {
        durationGap: 1.2,
        niiSensitivityPct: 6.5,
        eveChangePct: -4.0,
        lcrPct: 165,
        netWorthRatioPct: 12.5,
        capitalAdequacyPct: 14.0,
        delinquencyRatePct: 0.8,
        roaPct: 1.1,
        efficiencyRatioPct: 62,
        managementScore: 4,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['A'],
      overallScoreRange: [90, 100],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: ['maintain', 'monitor'],
    },
    tags: ['perfect', 'grade-a', 'baseline'],
  },

  // ── 2. Duration Gap at WARN threshold (3.2 years) ───────────────────────
  {
    name: 'Duration Gap at WARN threshold — 3.2 years',
    description:
      'Duration gap of 3.2 years triggers WARN on interest rate risk ' +
      '(threshold: 3.0yr). All other metrics are comfortable. Overall ' +
      'grade should be B, reflecting a single WARN category. ' +
      'Recommendations must reference duration gap reduction strategies.',
    input: {
      institutionId: 'ep-golden-002',
      metrics: {
        durationGap: 3.2,
        niiSensitivityPct: 12.0,
        eveChangePct: -8.0,
        lcrPct: 140,
        netWorthRatioPct: 10.0,
        capitalAdequacyPct: 12.0,
        delinquencyRatePct: 1.2,
        roaPct: 0.9,
        efficiencyRatioPct: 68,
        managementScore: 3,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['B'],
      overallScoreRange: [75, 89],
      categoryStatuses: {
        interestRateRisk: 'WARN',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: ['duration', 'gap', 'hedging'],
    },
    tags: ['warn-threshold', 'duration-gap', 'grade-b'],
  },

  // ── 3. LCR at FAIL threshold (85%) ──────────────────────────────────────
  {
    name: 'LCR at FAIL threshold — 85%',
    description:
      'LCR at 85% falls below the 100% regulatory minimum, triggering ' +
      'FAIL on liquidity. Capital and other metrics remain adequate. ' +
      'Overall grade should be C or lower, reflecting the critical ' +
      'liquidity failure. Recommendations must cite contingency funding.',
    input: {
      institutionId: 'ep-golden-003',
      metrics: {
        durationGap: 2.0,
        niiSensitivityPct: 10.0,
        eveChangePct: -6.0,
        lcrPct: 85,
        netWorthRatioPct: 9.0,
        capitalAdequacyPct: 11.0,
        delinquencyRatePct: 1.5,
        roaPct: 0.7,
        efficiencyRatioPct: 72,
        managementScore: 3,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['C', 'D'],
      overallScoreRange: [45, 74],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'FAIL',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: ['liquidity', 'contingency', 'funding'],
    },
    tags: ['fail-threshold', 'lcr', 'liquidity', 'grade-c'],
  },

  // ── 4. Multiple WARN categories ──────────────────────────────────────────
  {
    name: 'Multiple WARN categories — duration, earnings, management',
    description:
      'Three categories at WARN: duration gap at 3.5yr, ROA at 0.35% ' +
      '(below 0.5% threshold), and management score at 2 (below 3 ' +
      'threshold). Weighted composite should produce Grade C. ' +
      'Recommendations cover all three domains.',
    input: {
      institutionId: 'ep-golden-004',
      metrics: {
        durationGap: 3.5,
        niiSensitivityPct: 15.0,
        eveChangePct: -10.0,
        lcrPct: 120,
        netWorthRatioPct: 8.5,
        capitalAdequacyPct: 10.0,
        delinquencyRatePct: 2.0,
        roaPct: 0.35,
        efficiencyRatioPct: 80,
        managementScore: 2,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['C'],
      overallScoreRange: [55, 74],
      categoryStatuses: {
        interestRateRisk: 'WARN',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'WARN',
        management: 'WARN',
      },
      mustIncludeRecommendations: [
        'duration',
        'earnings',
        'governance',
        'board',
      ],
    },
    tags: ['multiple-warn', 'grade-c', 'composite'],
  },

  // ── 5. Critical capital failure (<5%) ────────────────────────────────────
  {
    name: 'Critical capital failure — net worth ratio below 5%',
    description:
      'Net worth ratio at 4.2% and capital adequacy at 5.0%, both below ' +
      'NCUA PCA well-capitalised threshold (7%). This is a critical ' +
      'failure that should dominate the grade regardless of other metrics. ' +
      'Grade D or F. Recommendations must cite PCA, capital restoration ' +
      'plan, and COSSEC notification requirements.',
    input: {
      institutionId: 'ep-golden-005',
      metrics: {
        durationGap: 2.5,
        niiSensitivityPct: 12.0,
        eveChangePct: -7.0,
        lcrPct: 110,
        netWorthRatioPct: 4.2,
        capitalAdequacyPct: 5.0,
        delinquencyRatePct: 3.5,
        roaPct: 0.2,
        efficiencyRatioPct: 85,
        managementScore: 2,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['D', 'F'],
      overallScoreRange: [10, 44],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'PASS',
        capitalAdequacy: 'FAIL',
        assetQuality: 'WARN',
        earnings: 'WARN',
        management: 'WARN',
      },
      mustIncludeRecommendations: ['capital', 'restoration', 'PCA', 'COSSEC'],
    },
    tags: ['critical', 'capital-fail', 'grade-d', 'pca'],
  },

  // ── 6. All categories at WARN boundaries ─────────────────────────────────
  {
    name: 'All categories at WARN boundaries — everything yellow',
    description:
      'Every metric sits exactly at or just past its WARN threshold: ' +
      'duration gap 3.0yr, LCR 100%, net worth 7.0%, NII sensitivity ' +
      '20%, delinquency 2.5%, ROA 0.5%, management 2. Grade C with ' +
      'all yellow. Tests the boundary-detection precision of the scorer.',
    input: {
      institutionId: 'ep-golden-006',
      metrics: {
        durationGap: 3.0,
        niiSensitivityPct: 20.0,
        eveChangePct: -12.0,
        lcrPct: 100,
        netWorthRatioPct: 7.0,
        capitalAdequacyPct: 8.0,
        delinquencyRatePct: 2.5,
        roaPct: 0.5,
        efficiencyRatioPct: 78,
        managementScore: 2,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['C'],
      overallScoreRange: [50, 69],
      categoryStatuses: {
        interestRateRisk: 'WARN',
        liquidity: 'WARN',
        capitalAdequacy: 'WARN',
        assetQuality: 'WARN',
        earnings: 'WARN',
        management: 'WARN',
      },
      mustIncludeRecommendations: ['improve', 'threshold', 'remediation'],
    },
    tags: ['all-warn', 'boundary', 'grade-c', 'edge-case'],
  },

  // ── 7. Mixed: 3 FAIL + 2 WARN + 1 PASS ─────────────────────────────────
  {
    name: 'Mixed profile — 3 FAIL + 2 WARN + 1 PASS',
    description:
      'Severely distressed institution: liquidity FAIL (LCR 70%), capital ' +
      'FAIL (net worth 3.8%), asset quality FAIL (delinquency 6.0%), ' +
      'earnings WARN (ROA 0.3%), management WARN (score 2), only interest ' +
      'rate risk PASS. Grade should reflect the weighted severity.',
    input: {
      institutionId: 'ep-golden-007',
      metrics: {
        durationGap: 2.0,
        niiSensitivityPct: 14.0,
        eveChangePct: -6.0,
        lcrPct: 70,
        netWorthRatioPct: 3.8,
        capitalAdequacyPct: 4.5,
        delinquencyRatePct: 6.0,
        roaPct: 0.3,
        efficiencyRatioPct: 90,
        managementScore: 2,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['D', 'F'],
      overallScoreRange: [5, 34],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'FAIL',
        capitalAdequacy: 'FAIL',
        assetQuality: 'FAIL',
        earnings: 'WARN',
        management: 'WARN',
      },
      mustIncludeRecommendations: [
        'liquidity',
        'capital',
        'delinquency',
        'remediation',
      ],
    },
    tags: ['mixed', 'severe', 'multi-fail', 'grade-d'],
  },

  // ── 8. NII Sensitivity at 36% (just above FAIL) ─────────────────────────
  {
    name: 'NII Sensitivity at 36% — FAIL on NII sensitivity',
    description:
      'NII sensitivity at 36% exceeds the 35% FAIL threshold (COSSEC ' +
      'Carta Circular 2021-02 limit). Other metrics are moderate. The ' +
      'NII FAIL should pull the overall grade down significantly and ' +
      'trigger specific interest rate hedging recommendations.',
    input: {
      institutionId: 'ep-golden-008',
      metrics: {
        durationGap: 4.5,
        niiSensitivityPct: 36.0,
        eveChangePct: -18.0,
        lcrPct: 115,
        netWorthRatioPct: 9.0,
        capitalAdequacyPct: 10.5,
        delinquencyRatePct: 1.8,
        roaPct: 0.7,
        efficiencyRatioPct: 72,
        managementScore: 3,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['C', 'D'],
      overallScoreRange: [40, 64],
      categoryStatuses: {
        interestRateRisk: 'FAIL',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: [
        'NII',
        'sensitivity',
        'hedge',
        'interest rate',
      ],
    },
    tags: ['nii-fail', 'interest-rate', 'threshold', 'grade-c'],
  },

  // ── 9. First-time assessment with no prior data ──────────────────────────
  {
    name: 'First-time assessment — no prior exam data',
    description:
      'New cooperativa undergoing its first regulatory examination. No ' +
      'previousAssessment data is provided. The agent must handle the ' +
      'absence gracefully: no improvement delta, no comparison references. ' +
      'Recommendations should include establishing baseline policies and ' +
      'governance documentation.',
    input: {
      institutionId: 'ep-golden-009',
      metrics: {
        durationGap: 2.8,
        niiSensitivityPct: 18.0,
        eveChangePct: -9.0,
        lcrPct: 125,
        netWorthRatioPct: 8.5,
        capitalAdequacyPct: 10.0,
        delinquencyRatePct: 2.2,
        roaPct: 0.6,
        efficiencyRatioPct: 74,
        managementScore: 3,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['B', 'C'],
      overallScoreRange: [60, 84],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: [
        'baseline',
        'policy',
        'governance',
        'documentation',
      ],
    },
    tags: ['first-time', 'no-prior', 'graceful-degradation'],
  },

  // ── 10. Improvement scenario — previous D, now B ─────────────────────────
  {
    name: 'Improvement scenario — previous grade D, now grade B',
    description:
      'Institution that was grade D (score 35) in the prior exam has ' +
      'improved to B-level metrics. The agent must detect the improvement, ' +
      'calculate the delta, and include positive-trend language in the ' +
      'output. Recommendations should acknowledge progress while ' +
      'identifying remaining gaps.',
    input: {
      institutionId: 'ep-golden-010',
      metrics: {
        durationGap: 2.5,
        niiSensitivityPct: 14.0,
        eveChangePct: -7.0,
        lcrPct: 135,
        netWorthRatioPct: 9.5,
        capitalAdequacyPct: 11.0,
        delinquencyRatePct: 1.5,
        roaPct: 0.8,
        efficiencyRatioPct: 70,
        managementScore: 3,
      },
      previousAssessment: {
        overallGrade: 'D',
        overallScore: 35,
      },
    },
    expectedOutput: {
      overallGradeOneOf: ['B'],
      overallScoreRange: [75, 89],
      categoryStatuses: {
        interestRateRisk: 'PASS',
        liquidity: 'PASS',
        capitalAdequacy: 'PASS',
        assetQuality: 'PASS',
        earnings: 'PASS',
        management: 'PASS',
      },
      mustIncludeRecommendations: ['improvement', 'progress', 'continue'],
    },
    tags: ['improvement', 'trend', 'delta', 'grade-b'],
  },
] as const;
