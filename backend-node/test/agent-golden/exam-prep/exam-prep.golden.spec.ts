/**
 * B6 — Exam Prep Agent Golden Spec Runner
 *
 * Iterates through all 10 golden cases using it.each, validates output shape
 * with the ExamPrepOutputSchema (Zod), asserts grades and scores fall within
 * expected ranges, verifies per-category statuses, and checks that required
 * recommendation keywords appear.
 *
 * Cases that require a live agent wired to real ALM data are marked as
 * it.todo (integration placeholders) until the full pipeline is connected.
 */

import { z } from 'zod';
import {
  ExamPrepOutputSchema,
  CamelComponentSchema,
  CamelRating,
  DocStatus,
} from '../../../src/agents/contracts/exam-prep.contracts';
import {
  EXAM_PREP_GOLDEN_CASES,
  type ExamPrepGoldenCase,
  type CategoryStatus,
} from './cases';

// ─── Helpers ───────────────────────────────────────────────────────────────

function inRange(value: number, [min, max]: [number, number]): boolean {
  return value >= min && value <= max;
}

/** Map our golden-case category names to CAMEL component names. */
const CATEGORY_TO_CAMEL: Record<string, string> = {
  capitalAdequacy: 'CAPITAL',
  assetQuality: 'ASSET_QUALITY',
  management: 'MANAGEMENT',
  earnings: 'EARNINGS',
  liquidity: 'LIQUIDITY',
};

/** Derive a CAMEL composite rating (1-5) from a letter grade. */
function gradeToComposite(grade: string): number {
  const map: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  return map[grade] ?? 3;
}

/** Derive a CAMEL component score from a category status. */
function statusToScore(status: CategoryStatus): number {
  const map: Record<CategoryStatus, number> = { PASS: 1, WARN: 3, FAIL: 5 };
  return map[status];
}

/**
 * Build a minimal valid ExamPrepOutput fixture from a golden case input.
 * Used for schema-shape validation tests. In integration mode the real agent
 * produces this; here we construct a synthetic output that satisfies the Zod
 * schema so we can verify our golden-case expectations are coherent.
 */
function buildSyntheticOutput(c: ExamPrepGoldenCase) {
  const now = new Date().toISOString();
  const midScore =
    (c.expectedOutput.overallScoreRange[0] +
      c.expectedOutput.overallScoreRange[1]) /
    2;
  const grade = c.expectedOutput.overallGradeOneOf[0];
  const composite = gradeToComposite(grade);

  const camelComponents = [
    'CAPITAL',
    'ASSET_QUALITY',
    'MANAGEMENT',
    'EARNINGS',
    'LIQUIDITY',
  ].map((component) => {
    // Find the matching category from our golden case
    const categoryKey = Object.entries(CATEGORY_TO_CAMEL).find(
      ([_, v]) => v === component,
    )?.[0];
    const status = categoryKey
      ? (c.expectedOutput.categoryStatuses[categoryKey] ?? 'PASS')
      : 'PASS';
    const score = statusToScore(status);

    return {
      component: component as
        | 'CAPITAL'
        | 'ASSET_QUALITY'
        | 'MANAGEMENT'
        | 'EARNINGS'
        | 'LIQUIDITY',
      score,
      finding: `${component} assessment: ${status}`,
      findingEs: `Evaluacion de ${component}: ${status}`,
      remediation: `Address ${component.toLowerCase()} ${status === 'FAIL' ? 'deficiencies immediately' : 'monitoring'}`,
      remediationEs: `Abordar ${component.toLowerCase()} ${status === 'FAIL' ? 'deficiencias inmediatamente' : 'monitoreo'}`,
    };
  });

  const passedCount = Object.values(c.expectedOutput.categoryStatuses).filter(
    (s) => s === 'PASS',
  ).length;

  // Build recommendations that include the must-have keywords
  const recommendations = c.expectedOutput.mustIncludeRecommendations.map(
    (keyword, i) => ({
      priority: i + 1,
      item: `Recommendation ${i + 1}: ${keyword} strategy should be reviewed and strengthened.`,
      itemEs: `Recomendacion ${i + 1}: estrategia de ${keyword} debe ser revisada y fortalecida.`,
      camelComponent: camelComponents[i % 5].component,
      estimatedImpactOnRating: 'Positive',
      deadline: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      owner: 'CFO',
    }),
  );

  return {
    agentId: 'exam_prep' as const,
    version: '1.0' as const,
    runId: `synthetic-${c.input.institutionId}`,
    institutionId: c.input.institutionId,
    timestamp: now,
    language: 'bilingual' as const,
    camelAssessment: {
      composite,
      components: camelComponents,
    },
    governanceChecklist: {
      total: 24 as const,
      passed: Math.min(24, Math.round((midScore / 100) * 24)),
      items: Array.from({ length: 24 }, (_, i) => ({
        item: `Governance item ${i + 1}`,
        status: (i < passedCount * 4 ? 'PASS' : 'FAIL') as
          | 'PASS'
          | 'FAIL'
          | 'PARTIAL',
      })),
    },
    redFlags: Object.values(c.expectedOutput.categoryStatuses).some(
      (s) => s === 'FAIL',
    )
      ? [
          {
            issue: 'Critical deficiency identified in examination prep.',
            issueEs:
              'Deficiencia critica identificada en preparacion de examen.',
            likelyExaminerComment:
              'The institution must address this finding before next review.',
            preparedResponse:
              'Management has initiated a remediation plan targeting 90-day resolution.',
            preparedResponseEs:
              'La gerencia ha iniciado un plan de remediacion con resolucion en 90 dias.',
          },
        ]
      : [],
    documentChecklist: [
      {
        document: 'ALM Policy',
        status: 'READY' as const,
        owner: 'CFO',
      },
      {
        document: 'Board Minutes',
        status: 'READY' as const,
        owner: 'Secretary',
      },
    ],
    remediationPlan: recommendations,
    managementLetterDraft: `Dear Board, the examination preparation assessment for ${c.input.institutionId} indicates an overall grade of ${grade}.`,
    managementLetterDraftEs: `Estimada Junta, la evaluacion de preparacion de examen para ${c.input.institutionId} indica una calificacion general de ${grade}.`,
    auditTraceId: `trace-${c.input.institutionId}`,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Exam Prep Agent — Golden Cases', () => {
  // Smoke: cases array is well-formed
  it('has exactly 10 golden cases', () => {
    expect(EXAM_PREP_GOLDEN_CASES).toHaveLength(10);
  });

  it('every case has a unique institutionId', () => {
    const ids = EXAM_PREP_GOLDEN_CASES.map((c) => c.input.institutionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── Schema shape validation (synthetic output) ─────────────────────────

  describe('Zod schema shape validation', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — synthetic output passes ExamPrepOutputSchema',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const result = ExamPrepOutputSchema.safeParse(output);

        if (!result.success) {
          const formatted = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n');
          fail(
            `Schema validation failed for "${goldenCase.name}":\n${formatted}`,
          );
        }

        expect(result.success).toBe(true);
      },
    );
  });

  // ── Grade and score range assertions ───────────────────────────────────

  describe('grade and score range assertions', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — overallGradeOneOf contains valid grades',
      (_name, goldenCase) => {
        const validGrades = ['A', 'B', 'C', 'D', 'F'];
        for (const grade of goldenCase.expectedOutput.overallGradeOneOf) {
          expect(validGrades).toContain(grade);
        }
      },
    );

    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — overallScoreRange is valid [0-100]',
      (_name, goldenCase) => {
        const [min, max] = goldenCase.expectedOutput.overallScoreRange;
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeLessThanOrEqual(100);
        expect(min).toBeLessThanOrEqual(max);
      },
    );

    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — CAMEL composite maps to expected grade',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const grade = goldenCase.expectedOutput.overallGradeOneOf[0];
        const expectedComposite = gradeToComposite(grade);
        expect(output.camelAssessment.composite).toBe(expectedComposite);

        // Verify composite is valid CAMEL rating (1-5)
        expect(
          CamelRating.safeParse(output.camelAssessment.composite).success,
        ).toBe(true);
      },
    );
  });

  // ── Category status assertions ─────────────────────────────────────────

  describe('category status assertions', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — all declared category statuses are valid',
      (_name, goldenCase) => {
        const validStatuses: CategoryStatus[] = ['PASS', 'WARN', 'FAIL'];
        for (const [category, status] of Object.entries(
          goldenCase.expectedOutput.categoryStatuses,
        )) {
          expect(validStatuses).toContain(status);
          // Verify category maps to a known CAMEL component (or interestRateRisk)
          const knownCategories = [
            'interestRateRisk',
            'liquidity',
            'capitalAdequacy',
            'assetQuality',
            'earnings',
            'management',
          ];
          expect(knownCategories).toContain(category);
        }
      },
    );

    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — CAMEL component scores reflect category statuses',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);

        for (const [category, expectedStatus] of Object.entries(
          goldenCase.expectedOutput.categoryStatuses,
        )) {
          const camelName = CATEGORY_TO_CAMEL[category];
          if (!camelName) continue; // interestRateRisk doesn't map 1:1 to CAMEL

          const component = output.camelAssessment.components.find(
            (comp) => comp.component === camelName,
          );
          if (!component) continue;

          const expectedScore = statusToScore(expectedStatus);
          expect(component.score).toBe(expectedScore);
        }
      },
    );
  });

  // ── Recommendation keyword assertions ──────────────────────────────────

  describe('recommendation keyword assertions', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — synthetic output includes all must-have recommendation keywords',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const allRecommendationText = output.remediationPlan
          .map((r) => `${r.item} ${r.itemEs}`)
          .join(' ')
          .toLowerCase();

        for (const keyword of goldenCase.expectedOutput
          .mustIncludeRecommendations) {
          expect(allRecommendationText).toContain(keyword.toLowerCase());
        }
      },
    );

    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — mustIncludeRecommendations is non-empty',
      (_name, goldenCase) => {
        expect(
          goldenCase.expectedOutput.mustIncludeRecommendations.length,
        ).toBeGreaterThan(0);
      },
    );
  });

  // ── Grade-to-score coherence ───────────────────────────────────────────

  describe('grade-to-score coherence', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — grade and score range are mutually consistent',
      (_name, goldenCase) => {
        const [minScore, maxScore] =
          goldenCase.expectedOutput.overallScoreRange;
        const grades = goldenCase.expectedOutput.overallGradeOneOf;

        // Grade-to-score band mapping (approximate)
        const gradeBands: Record<string, [number, number]> = {
          A: [85, 100],
          B: [70, 94],
          C: [45, 79],
          D: [20, 54],
          F: [0, 34],
        };

        // At least one declared grade's band must overlap with the score range
        const hasOverlap = grades.some((g) => {
          const [gMin, gMax] = gradeBands[g] ?? [0, 100];
          return minScore <= gMax && maxScore >= gMin;
        });

        expect(hasOverlap).toBe(true);
      },
    );
  });

  // ── Bilingual completeness (synthetic) ─────────────────────────────────

  describe('bilingual completeness', () => {
    it.each(EXAM_PREP_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — synthetic output has both EN and ES fields',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);

        // Management letter
        expect(output.managementLetterDraft.length).toBeGreaterThan(0);
        expect(output.managementLetterDraftEs.length).toBeGreaterThan(0);

        // CAMEL components
        for (const comp of output.camelAssessment.components) {
          expect(comp.finding.length).toBeGreaterThan(0);
          expect(comp.findingEs.length).toBeGreaterThan(0);
          expect(comp.remediation.length).toBeGreaterThan(0);
          expect(comp.remediationEs.length).toBeGreaterThan(0);
        }
      },
    );
  });

  // ── First-time / improvement-specific logic ────────────────────────────

  describe('edge case handling', () => {
    it('first-time case has no previousAssessment', () => {
      const firstTime = EXAM_PREP_GOLDEN_CASES.find((c) =>
        c.tags.includes('first-time'),
      );
      expect(firstTime).toBeDefined();
      expect(firstTime!.input.previousAssessment).toBeUndefined();
    });

    it('improvement case has previousAssessment with lower grade', () => {
      const improvement = EXAM_PREP_GOLDEN_CASES.find((c) =>
        c.tags.includes('improvement'),
      );
      expect(improvement).toBeDefined();
      expect(improvement!.input.previousAssessment).toBeDefined();
      expect(improvement!.input.previousAssessment!.overallGrade).toBe('D');

      // Current expected grade should be better than previous
      const currentGrades = improvement!.expectedOutput.overallGradeOneOf;
      const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
      const prevIdx = gradeOrder.indexOf(
        improvement!.input.previousAssessment!.overallGrade,
      );
      const bestCurrentIdx = Math.min(
        ...currentGrades.map((g) => gradeOrder.indexOf(g)),
      );
      expect(bestCurrentIdx).toBeLessThan(prevIdx);
    });
  });

  // ── Integration placeholders ───────────────────────────────────────────
  // These will be activated once the exam-prep agent is wired to
  // real ALM computation services and produces live output.

  describe('integration tests (pending agent wiring)', () => {
    it.todo('Perfect institution — live agent produces Grade A with score 95+');
    it.todo(
      'Duration Gap WARN — live agent flags IRR with duration hedging recs',
    );
    it.todo(
      'LCR FAIL — live agent produces contingency funding recommendations',
    );
    it.todo(
      'Multiple WARN — live agent weighted score reflects all warning categories',
    );
    it.todo('Critical capital failure — live agent triggers PCA language');
    it.todo('All WARN boundaries — live agent boundary detection is precise');
    it.todo('Mixed FAIL/WARN/PASS — live agent correctly weights severity');
    it.todo(
      'NII Sensitivity FAIL — live agent produces hedging recommendations',
    );
    it.todo(
      'First-time assessment — live agent gracefully handles missing prior data',
    );
    it.todo(
      'Improvement scenario — live agent computes improvement delta correctly',
    );
  });
});
