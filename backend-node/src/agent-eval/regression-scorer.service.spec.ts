import type { AgentRunResult, GoldenCase } from './contracts';
import { RegressionScorerService } from './regression-scorer.service';
import { EvalThresholds } from './thresholds';

const gold = (over: Partial<GoldenCase> = {}): GoldenCase => ({
  id: 'golden-001',
  name: 'High rate risk, adequate liquidity',
  agentType: 'ALM_DECISION',
  params: { balanceSheetId: 'bs-001' },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    healthScoreRange: [50, 70],
    hasRegulatoryReference: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
    maxWords: 600,
    ...over.expected,
  },
  ...over,
});

const result = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  runId: 'r-1',
  institutionId: 'i-1',
  agentType: 'ALM_DECISION',
  narrative: '',
  computeMs: 100,
  output: {
    topRisks: [
      {
        domain: 'Interest Rate Risk',
        dollarImpact: 2_400_000,
        recommendation: 'Hedge $15M duration by 2026-06-30',
        regulatoryRef: '12 CFR 741.3',
      },
    ],
    healthScore: { score: 62, label: 'SATISFACTORY' },
    languages: { en: 'Rate risk elevated.', es: 'Riesgo de tasa elevado.' },
  },
  trace: Array.from({ length: 6 }, (_, i) => ({
    id: `s-${i}`,
    runId: 'r-1',
    stepNumber: i,
    stepType: 'TOOL_CALL' as const,
    toolName: `t-${i}`,
    toolInput: null,
    toolOutput: { x: i },
    llmPrompt: null,
    llmOutput: null,
    durationMs: 5,
  })),
  ...over,
});

describe('RegressionScorerService', () => {
  let s: RegressionScorerService;

  beforeEach(() => {
    s = new RegressionScorerService();
  });

  it('perfect run scores 100 across the board', () => {
    const score = s.scoreCase(gold(), result(), 0);
    expect(score.score.total).toBeCloseTo(100, 1);
    expect(score.failures).toEqual([]);
  });

  it('penalizes missing tool calls', () => {
    const partial = result({ trace: result().trace.slice(0, 3) });
    const score = s.scoreCase(gold(), partial, 0);
    expect(score.score.toolCoverage).toBeCloseTo(50, 1);
    expect(score.failures.join('\n')).toContain('tool coverage');
  });

  it('penalizes missing dollar quantification', () => {
    const r = result();
    r.output.topRisks = [
      { domain: 'Interest Rate Risk', regulatoryRef: '12 CFR 741.3' },
    ];
    const score = s.scoreCase(gold(), r, 0);
    expect(score.score.dollarQuantification).toBe(0);
  });

  it('hedge count reduces specificity', () => {
    const score1 = s.scoreCase(gold(), result(), 0);
    const score2 = s.scoreCase(gold(), result(), 10);
    expect(score2.score.specificity).toBeLessThan(score1.score.specificity);
  });

  it('penalizes bilingual gap when required', () => {
    const r = result();
    r.output.languages = { en: 'only english' };
    const score = s.scoreCase(gold(), r, 0);
    expect(score.score.bilingualCompleteness).toBe(50);
    expect(score.failures.some((f) => f.includes('bilingual'))).toBe(true);
  });

  it('reports deploy gate failure when total < 80', () => {
    const bad = result({
      output: {
        topRisks: [],
        healthScore: { score: 10, label: 'WEAK' },
        languages: {},
      },
    });
    const score = s.scoreCase(gold(), bad, 20);
    const report = s.buildReport([score], null);
    expect(report.passesDeployGate).toBe(false);
    expect(report.blockedCases).toContain('golden-001');
    expect(report.averageScore).toBeLessThan(EvalThresholds.deployGate);
  });

  it('deltaFromBaseline is null when no baseline provided', () => {
    const score = s.scoreCase(gold(), result(), 0);
    const report = s.buildReport([score], null);
    expect(report.deltaFromBaseline).toBeNull();
  });

  it('deltaFromBaseline is negative for regression', () => {
    const score = s.scoreCase(gold(), result(), 0);
    const report = s.buildReport([score], 95);
    expect(report.deltaFromBaseline).toBeLessThanOrEqual(5);
  });
});
