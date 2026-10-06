import { HedgeLanguageDetector } from '../agent-trust/hedge-language.detector';
import type { AgentExecutor } from './agent-executor.port';
import type { AgentRunResult, GoldenCase } from './contracts';
import { GoldenRunnerService } from './golden-runner.service';
import { RegressionScorerService } from './regression-scorer.service';

const gold: GoldenCase = {
  id: 'golden-001',
  name: 'High rate risk, adequate liquidity',
  agentType: 'ALM_DECISION',
  params: { balanceSheetId: 'golden-001' },
  expected: {
    topRiskDomain: 'Interest Rate Risk',
    hasMinDollarQuantification: true,
    toolsCalledMin: 6,
    bilingualRequired: true,
  },
};

const mockResult: AgentRunResult = {
  runId: 'r-1',
  institutionId: 'test-inst',
  agentType: 'ALM_DECISION',
  narrative: 'Rate risk is the top concern.',
  computeMs: 500,
  output: {
    topRisks: [
      {
        domain: 'Interest Rate Risk',
        dollarImpact: 2_400_000,
        recommendation: 'Hedge $15M by 2026-06-30',
        regulatoryRef: '12 CFR 741.3',
      },
    ],
    healthScore: { score: 62, label: 'SATISFACTORY' },
    languages: { en: 'Rate risk.', es: 'Riesgo de tasa.' },
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
};

const mockExecutor: AgentExecutor = {
  execute: jest.fn().mockResolvedValue(mockResult),
};

describe('GoldenRunnerService', () => {
  let svc: GoldenRunnerService;

  beforeEach(() => {
    svc = new GoldenRunnerService(
      mockExecutor,
      new RegressionScorerService(),
      new HedgeLanguageDetector(),
    );
    jest.clearAllMocks();
  });

  it('runs cases against the executor and returns a report', async () => {
    const report = await svc.run('test-inst', [gold]);

    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(mockExecutor.execute).toHaveBeenCalledWith({
      agentType: 'ALM_DECISION',
      institutionId: 'test-inst',
      params: { balanceSheetId: 'golden-001' },
    });
    expect(report.cases).toHaveLength(1);
    expect(report.averageScore).toBeGreaterThan(0);
    expect(report.runAt).toBeTruthy();
  });

  it('filters cases when opts.only is specified', async () => {
    const report = await svc.run(
      'test-inst',
      [gold, { ...gold, id: 'golden-002', name: 'Other' }],
      {
        only: ['golden-001'],
      },
    );
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0].caseId).toBe('golden-001');
  });

  it('computes delta from baseline when provided', async () => {
    const report = await svc.run('test-inst', [gold], { baselineAverage: 95 });
    expect(report.deltaFromBaseline).not.toBeNull();
    expect(typeof report.deltaFromBaseline).toBe('number');
  });

  it('throws when no executor is provided', async () => {
    const noExec = new GoldenRunnerService(
      null,
      new RegressionScorerService(),
      new HedgeLanguageDetector(),
    );
    await expect(noExec.run('test-inst', [gold])).rejects.toThrow(
      'AGENT_EXECUTOR',
    );
  });
});
