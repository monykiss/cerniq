import { scoreOffline, runBatch, printScorecard } from './eval-runner';
import { MockLlmBridge, script } from './mock-llm-bridge';
import { loadCase, loadAllCases } from './load-case';
import type { GoldenCase } from './fixture-types';
import type { AuditStep } from '../scoring/dimensions';
import { PASS_THRESHOLD } from '../scoring/weights';

// ─── Mock LLM Bridge ────────────────────────────────────────────────────────

describe('MockLlmBridge', () => {
  const testScript = script()
    .forCase('test-001', 'simple two-turn')
    .addToolUseTurn([{ id: 'tc1', name: 'runFullSwarm', input: {} }])
    .addEndTurn('{"result": "done"}')
    .build();

  it('replays scripted turns in order', async () => {
    const mock = new MockLlmBridge(testScript);

    const turn1 = await mock.turn({
      system: 'test',
      messages: [],
      tools: [],
    });
    expect(turn1.stopReason).toBe('tool_use');
    expect(turn1.toolCalls[0].name).toBe('runFullSwarm');

    const turn2 = await mock.turn({
      system: 'test',
      messages: [],
      tools: [],
    });
    expect(turn2.stopReason).toBe('end_turn');
    expect(turn2.text).toContain('done');
  });

  it('throws when script exhausted', async () => {
    const mock = new MockLlmBridge(testScript);
    await mock.turn({ system: '', messages: [], tools: [] });
    await mock.turn({ system: '', messages: [], tools: [] });

    await expect(
      mock.turn({ system: '', messages: [], tools: [] }),
    ).rejects.toThrow('script exhausted');
  });

  it('tracks consumed turns', async () => {
    const mock = new MockLlmBridge(testScript);
    expect(mock.turnsConsumed).toBe(0);
    expect(mock.turnsRemaining).toBe(2);
    await mock.turn({ system: '', messages: [], tools: [] });
    expect(mock.turnsConsumed).toBe(1);
    expect(mock.turnsRemaining).toBe(1);
  });

  it('resets state', async () => {
    const mock = new MockLlmBridge(testScript);
    await mock.turn({ system: '', messages: [], tools: [] });
    mock.reset();
    expect(mock.turnsConsumed).toBe(0);
    expect(mock.callLog).toHaveLength(0);
  });
});

// ─── Script builder validation ──────────────────────────────────────────────

describe('ScriptBuilder', () => {
  it('rejects empty scripts', () => {
    expect(() => script().forCase('x').build()).toThrow('at least one turn');
  });

  it('rejects scripts ending with tool_use', () => {
    expect(() =>
      script()
        .forCase('x')
        .addToolUseTurn([{ id: 't', name: 'a', input: {} }])
        .build(),
    ).toThrow('last turn must be end_turn');
  });

  it('builds valid script', () => {
    const s = script()
      .forCase('test', 'desc')
      .addToolUseTurn([{ id: 't1', name: 'runFullSwarm', input: {} }])
      .addEndTurn('output')
      .build();
    expect(s.caseId).toBe('test');
    expect(s.turns).toHaveLength(2);
  });
});

// ─── Offline eval scoring ───────────────────────────────────────────────────

describe('scoreOffline', () => {
  const goodOutput = {
    topRisks: [
      {
        domain: 'Interest Rate Risk',
        dollarImpact: 2100000,
        finding: 'NII at +200bps drops 6.2% ($2.1M)',
        findingEs: 'NII a +200bps disminuye 6.2% ($2.1M)',
        regulatoryRef: 'COSSEC Carta Circular 2021-02',
      },
      {
        domain: 'Liquidity Risk',
        dollarImpact: 850000,
        finding: 'LCR at 112% — below internal policy',
        findingEs: 'LCR en 112% — debajo de política interna',
        regulatoryRef: 'COSSEC Reg. 8866',
      },
    ],
    decisionQueue: [
      {
        action: 'Shift $15M from fixed to variable',
        actionEs: 'Mover $15M de fijo a variable',
        expectedImpact: '+12bps NIM (+$840K)',
        regulatoryRef: 'COSSEC Carta Circular 2021-02',
      },
    ],
    brief: 'Elevated interest rate risk.',
    briefEs: 'Riesgo de tasa de interés elevado.',
  };

  const trace: AuditStep[] = [
    { stepKind: 'TOOL_CALL', toolName: 'runFullSwarm', toolOutput: null },
    { stepKind: 'TOOL_CALL', toolName: 'runRateShock', toolOutput: null },
    { stepKind: 'TOOL_CALL', toolName: 'getRepricingGap', toolOutput: null },
    { stepKind: 'TOOL_CALL', toolName: 'getLCR', toolOutput: null },
    { stepKind: 'TOOL_CALL', toolName: 'getCECL', toolOutput: null },
    { stepKind: 'TOOL_CALL', toolName: 'getConcentration', toolOutput: null },
  ];

  const goldenCase: GoldenCase = {
    id: 'alm-001',
    name: 'High rate risk, adequate liquidity',
    agentId: 'ALM_DECISION',
    description: 'test',
    input: {},
    expectedFindings: {
      topRiskDomain: 'Interest Rate Risk',
      healthScoreRange: [50, 70],
      minToolsCalled: 6,
      requiredTools: ['runFullSwarm', 'runRateShock'],
      requiresBilingual: true,
      schemaValidator: () => true,
    },
  };

  it('scores a good output above threshold', () => {
    const result = scoreOffline({
      goldenCase,
      actualOutput: goodOutput,
      auditTrace: trace,
    });
    expect(result.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(result.pass).toBe(true);
    expect(result.toolsCalled).toContain('runFullSwarm');
    expect(result.toolsCalled).toContain('runRateShock');
  });

  it('fails empty output', () => {
    const result = scoreOffline({
      goldenCase,
      actualOutput: {},
      auditTrace: [],
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBeLessThan(PASS_THRESHOLD);
  });
});

// ─── Batch eval ─────────────────────────────────────────────────────────────

describe('runBatch', () => {
  it('returns allPass when every case passes', () => {
    const trace: AuditStep[] = Array.from({ length: 6 }, (_, i) => ({
      stepKind: 'TOOL_CALL',
      toolName: `tool${i}`,
      toolOutput: null,
    }));

    const goodOutput = {
      topRisks: [
        {
          dollarImpact: 100,
          finding: '$100K risk',
          findingEs: '$100K riesgo',
          regulatoryRef: 'REG-1',
        },
      ],
      decisionQueue: [
        {
          action: 'Do $50K thing',
          actionEs: 'Hacer cosa de $50K',
          expectedImpact: '+5bps',
          regulatoryRef: 'REG-1',
        },
      ],
      brief: 'test',
      briefEs: 'prueba',
    };

    const cases = [
      {
        goldenCase: {
          id: 'c1',
          name: 'c1',
          agentId: 'ALM',
          description: '',
          input: {},
          expectedFindings: {
            minToolsCalled: 6,
            requiresBilingual: true,
            schemaValidator: () => true,
          },
        },
        actualOutput: goodOutput,
        auditTrace: trace,
      },
    ];

    const { results, allPass, avgScore } = runBatch(cases);
    expect(allPass).toBe(true);
    expect(avgScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(results).toHaveLength(1);
  });
});

// ─── Fixture loader ─────────────────────────────────────────────────────────

describe('loadCase', () => {
  it('loads a golden case from disk', () => {
    const c = loadCase(
      'alm-decision',
      '001-high-rate-risk-adequate-liquidity.json',
    );
    expect(c.id).toBe('alm-001');
    expect(c.agentId).toBe('ALM_DECISION');
    expect(c.expectedFindings.minToolsCalled).toBe(6);
  });

  it('loads all cases for an agent', () => {
    const cases = loadAllCases('alm-decision');
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases[0].id).toBeDefined();
  });
});
