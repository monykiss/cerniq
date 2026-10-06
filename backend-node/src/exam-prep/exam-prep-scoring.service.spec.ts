import {
  ExamPrepScoringService,
  CATEGORY_WEIGHTS,
  THRESHOLDS,
} from './exam-prep-scoring.service';

describe('ExamPrepScoringService', () => {
  let service: ExamPrepScoringService;
  const mockPrisma = {
    balanceSheetItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;

  beforeEach(() => {
    service = new ExamPrepScoringService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Category weights ────────────────────────────────────────────────────

  it('category weights sum to 1.0 (100%)', () => {
    const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce(
      (sum, w) => sum + w,
      0,
    );
    expect(totalWeight).toBeCloseTo(1.0, 10);
  });

  it('has exactly 12 categories', () => {
    expect(Object.keys(CATEGORY_WEIGHTS)).toHaveLength(12);
  });

  it('ALM_POLICY has the highest weight at 15%', () => {
    expect(CATEGORY_WEIGHTS.ALM_POLICY).toBe(0.15);
    const maxWeight = Math.max(...Object.values(CATEGORY_WEIGHTS));
    expect(CATEGORY_WEIGHTS.ALM_POLICY).toBe(maxWeight);
  });

  // ── Letter grade assignment ─────────────────────────────────────────────

  it('assigns grade A for scores 90-100', () => {
    expect(service.assignLetterGrade(90)).toBe('A');
    expect(service.assignLetterGrade(95)).toBe('A');
    expect(service.assignLetterGrade(100)).toBe('A');
  });

  it('assigns grade B for scores 80-89', () => {
    expect(service.assignLetterGrade(80)).toBe('B');
    expect(service.assignLetterGrade(85)).toBe('B');
    expect(service.assignLetterGrade(89)).toBe('B');
  });

  it('assigns grade C for scores 70-79', () => {
    expect(service.assignLetterGrade(70)).toBe('C');
    expect(service.assignLetterGrade(75)).toBe('C');
    expect(service.assignLetterGrade(79)).toBe('C');
  });

  it('assigns grade D for scores 60-69', () => {
    expect(service.assignLetterGrade(60)).toBe('D');
    expect(service.assignLetterGrade(65)).toBe('D');
    expect(service.assignLetterGrade(69)).toBe('D');
  });

  it('assigns grade F for scores below 60', () => {
    expect(service.assignLetterGrade(59)).toBe('F');
    expect(service.assignLetterGrade(30)).toBe('F');
    expect(service.assignLetterGrade(0)).toBe('F');
  });

  // ── Threshold compliance: Duration Gap ──────────────────────────────────

  it('Duration Gap: PASS when < 3.0 years', () => {
    const result = service.computeCategoryScore('DURATION_GAP', {
      value: 2.5,
    });
    expect(result.compliance).toBe('PASS');
    expect(result.score).toBe(95);
  });

  it('Duration Gap: WARN when 3.0-4.5 years', () => {
    const result = service.computeCategoryScore('DURATION_GAP', {
      value: 3.5,
    });
    expect(result.compliance).toBe('WARN');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.score).toBeLessThan(80);
  });

  it('Duration Gap: FAIL when > 4.5 years', () => {
    const result = service.computeCategoryScore('DURATION_GAP', {
      value: 5.0,
    });
    expect(result.compliance).toBe('FAIL');
    expect(result.score).toBeLessThan(60);
  });

  // ── Threshold compliance: NII Sensitivity ───────────────────────────────

  it('NII Sensitivity: PASS when < 20%', () => {
    const result = service.computeCategoryScore('NII_SENSITIVITY', {
      value: 15,
    });
    expect(result.compliance).toBe('PASS');
  });

  it('NII Sensitivity: WARN when 20-35%', () => {
    const result = service.computeCategoryScore('NII_SENSITIVITY', {
      value: 25,
    });
    expect(result.compliance).toBe('WARN');
  });

  it('NII Sensitivity: FAIL when > 35%', () => {
    const result = service.computeCategoryScore('NII_SENSITIVITY', {
      value: 40,
    });
    expect(result.compliance).toBe('FAIL');
  });

  // ── Threshold compliance: EVE ───────────────────────────────────────────

  it('EVE: PASS when change > -20%', () => {
    const result = service.computeCategoryScore('EVE', {
      value: -10,
    });
    expect(result.compliance).toBe('PASS');
  });

  it('EVE: WARN when -20% to -30%', () => {
    const result = service.computeCategoryScore('EVE', {
      value: -25,
    });
    expect(result.compliance).toBe('WARN');
  });

  it('EVE: FAIL when < -30%', () => {
    const result = service.computeCategoryScore('EVE', {
      value: -35,
    });
    expect(result.compliance).toBe('FAIL');
  });

  // ── Threshold compliance: LCR ───────────────────────────────────────────

  it('LCR: PASS when >= 100%', () => {
    const result = service.computeCategoryScore('LIQUIDITY', {
      value: 110,
    });
    expect(result.compliance).toBe('PASS');
  });

  it('LCR: WARN when 90-100%', () => {
    const result = service.computeCategoryScore('LIQUIDITY', {
      value: 95,
    });
    expect(result.compliance).toBe('WARN');
  });

  it('LCR: FAIL when < 90%', () => {
    const result = service.computeCategoryScore('LIQUIDITY', {
      value: 85,
    });
    expect(result.compliance).toBe('FAIL');
  });

  // ── Threshold compliance: Net Worth ─────────────────────────────────────

  it('Net Worth: PASS when >= 10%', () => {
    const result = service.computeCategoryScore('CAPITAL_ADEQUACY', {
      value: 12,
    });
    expect(result.compliance).toBe('PASS');
  });

  it('Net Worth: WARN when 7-10%', () => {
    const result = service.computeCategoryScore('CAPITAL_ADEQUACY', {
      value: 8,
    });
    expect(result.compliance).toBe('WARN');
  });

  it('Net Worth: FAIL when < 7%', () => {
    const result = service.computeCategoryScore('CAPITAL_ADEQUACY', {
      value: 5,
    });
    expect(result.compliance).toBe('FAIL');
  });

  // ── Category scoring: weighted scores ───────────────────────────────────

  it('weighted score = score * weight for each category', () => {
    const result = service.computeCategoryScore('DURATION_GAP', {
      value: 2.0,
    });
    expect(result.weight).toBe(CATEGORY_WEIGHTS.DURATION_GAP);
    expect(result.weightedScore).toBeCloseTo(result.score * result.weight, 5);
  });

  // ── Policy-based scoring ──────────────────────────────────────────────

  it('policy-based: PASS when policy exists with evidence', () => {
    const result = service.computeCategoryScore('GOVERNANCE', {
      value: 0,
      hasPolicy: true,
      evidenceAvailable: true,
    });
    expect(result.compliance).toBe('PASS');
    expect(result.score).toBe(95);
  });

  it('policy-based: WARN when policy exists but no evidence', () => {
    const result = service.computeCategoryScore('GOVERNANCE', {
      value: 0,
      hasPolicy: true,
      evidenceAvailable: false,
    });
    expect(result.compliance).toBe('WARN');
    expect(result.score).toBe(70);
  });

  it('policy-based: FAIL when no policy', () => {
    const result = service.computeCategoryScore('GOVERNANCE', {
      value: 0,
      hasPolicy: false,
      evidenceAvailable: false,
    });
    expect(result.compliance).toBe('FAIL');
    expect(result.score).toBe(30);
  });

  // ── Full assessment ─────────────────────────────────────────────────────

  it('runs full assessment with demo data and returns all fields', async () => {
    const assessment = await service.assessReadiness('inst-test', 'test-user');

    expect(assessment.id).toBeDefined();
    expect(assessment.institutionId).toBe('inst-test');
    expect(assessment.assessedBy).toBe('test-user');
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(assessment.letterGrade);
    expect(assessment.categories).toHaveLength(12);
    expect(
      assessment.passCount + assessment.warnCount + assessment.failCount,
    ).toBe(12);
    expect(assessment.summary).toBeTruthy();
    expect(assessment.summaryEs).toBeTruthy();
  });

  it('bilingual summaries are both populated', async () => {
    const assessment = await service.assessReadiness('inst-1', 'user');

    expect(assessment.summary).toContain('Grade');
    expect(assessment.summaryEs).toContain('Grado');
    expect(assessment.summary).toContain(String(assessment.overallScore));
    expect(assessment.summaryEs).toContain(String(assessment.overallScore));
  });

  it('stores assessment in history', async () => {
    await service.assessReadiness('inst-history', 'user1');
    await service.assessReadiness('inst-history', 'user2');

    const history = await service.getAssessmentHistory('inst-history');
    expect(history).toHaveLength(2);
    // Most recent first
    expect(history[0].assessedBy).toBe('user2');
    expect(history[1].assessedBy).toBe('user1');
  });

  it('getLatestAssessment returns null when none exist', async () => {
    const result = await service.getLatestAssessment('nonexistent');
    expect(result).toBeNull();
  });

  it('remediation plan includes entries for non-passing categories', async () => {
    const assessment = await service.assessReadiness(
      'inst-remediation',
      'user',
    );

    const nonPassing = assessment.categories.filter(
      (c) => c.compliance !== 'PASS',
    );
    // Every non-passing category should contribute to remediation
    expect(assessment.remediationPlan.length).toBe(nonPassing.length);
    expect(assessment.remediationPlanEs.length).toBe(nonPassing.length);
  });

  // ── Threshold definitions ─────────────────────────────────────────────

  it('all threshold specs have units and bilingual names', () => {
    for (const [key, spec] of Object.entries(THRESHOLDS)) {
      expect(spec.unit).toBeTruthy();
      expect(spec.name).toBeTruthy();
      expect(spec.nameEs).toBeTruthy();
    }
  });

  it('defines thresholds for 6 key metrics', () => {
    expect(Object.keys(THRESHOLDS)).toHaveLength(6);
    expect(THRESHOLDS).toHaveProperty('DURATION_GAP');
    expect(THRESHOLDS).toHaveProperty('NII_SENSITIVITY');
    expect(THRESHOLDS).toHaveProperty('EVE');
    expect(THRESHOLDS).toHaveProperty('LCR');
    expect(THRESHOLDS).toHaveProperty('NET_WORTH');
    expect(THRESHOLDS).toHaveProperty('CAPITAL');
  });
});
