import {
  scoreToolCoverage,
  scoreDollarQuantification,
  scoreSpecificity,
  scoreRegulatoryRef,
  scoreBilingual,
  scoreFormatCompliance,
} from './dimensions';
import { scoreAgentRun, DEFAULT_WEIGHTS, PASS_THRESHOLD } from './weights';
import type { AuditStep, ExpectedFindings } from './dimensions';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTrace(tools: string[]): AuditStep[] {
  return tools.map((t) => ({
    stepKind: 'TOOL_CALL',
    toolName: t,
    toolOutput: null,
  }));
}

const GOOD_OUTPUT = {
  topRisks: [
    {
      finding: 'NII at +200bps drops 6.2% ($2.1M).',
      findingEs: 'NII a +200bps disminuye 6.2% ($2.1M).',
      dollarImpact: 2_100_000,
      regulatoryRef: 'COSSEC Carta Circular 2021-02',
    },
    {
      finding: 'LCR at 112% — below policy.',
      findingEs: 'LCR en 112% — debajo de política.',
      dollarImpact: 850_000,
      regulatoryRef: 'COSSEC Reg. 8866',
    },
  ],
  decisionQueue: [
    {
      action: 'Shift $15M to variable-rate.',
      actionEs: 'Mover $15M a tasa variable.',
      expectedImpact: '+12bps NIM (+$840K)',
      regulatoryRef: 'COSSEC Carta Circular 2021-02',
    },
  ],
  brief: 'This institution faces elevated interest rate risk.',
  briefEs: 'Esta institución enfrenta un riesgo de tasa elevado.',
};

// ─── Tool Coverage ──────────────────────────────────────────────────────────

describe('scoreToolCoverage', () => {
  it('returns 1.0 when all required tools are called', () => {
    const trace = makeTrace([
      'runFullSwarm',
      'runRateShock',
      'getLCR',
      'getCECL',
      'getEWS',
      'getConcentration',
    ]);
    const result = scoreToolCoverage(trace, {
      minToolsCalled: 6,
      requiredTools: ['runFullSwarm', 'runRateShock'],
    });
    expect(result.score).toBe(1);
  });

  it('penalises missing required tools', () => {
    const trace = makeTrace(['getLCR']);
    const result = scoreToolCoverage(trace, {
      minToolsCalled: 6,
      requiredTools: ['runFullSwarm', 'runRateShock'],
    });
    expect(result.score).toBeLessThan(0.5);
    expect(result.evidence.some((e) => e.includes('missing'))).toBe(true);
  });

  it('caps ratio at 1.0 when more tools called than minimum', () => {
    const trace = makeTrace(Array.from({ length: 10 }, (_, i) => `tool${i}`));
    const result = scoreToolCoverage(trace, { minToolsCalled: 6 });
    expect(result.score).toBe(1);
  });
});

// ─── Dollar Quantification ──────────────────────────────────────────────────

describe('scoreDollarQuantification', () => {
  it('returns 1.0 when all findings have dollar amounts', () => {
    const result = scoreDollarQuantification(GOOD_OUTPUT);
    expect(result.score).toBe(1);
  });

  it('returns 0 when no topRisks', () => {
    const result = scoreDollarQuantification({});
    expect(result.score).toBe(0);
  });

  it('returns partial when some findings lack dollars', () => {
    const result = scoreDollarQuantification({
      topRisks: [
        { dollarImpact: 100 },
        { dollarImpact: 0 },
        { dollarImpact: 200 },
      ],
    });
    expect(result.score).toBeCloseTo(2 / 3);
  });
});

// ─── Specificity ────────────────────────────────────────────────────────────

describe('scoreSpecificity', () => {
  it('returns 1.0 for fully specific output', () => {
    const result = scoreSpecificity(GOOD_OUTPUT);
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('returns 0 for empty output', () => {
    const result = scoreSpecificity({});
    expect(result.score).toBe(0);
  });
});

// ─── Regulatory Reference ───────────────────────────────────────────────────

describe('scoreRegulatoryRef', () => {
  it('returns 1.0 when all items have references', () => {
    const result = scoreRegulatoryRef(GOOD_OUTPUT);
    expect(result.score).toBe(1);
  });

  it('penalises missing refs', () => {
    const result = scoreRegulatoryRef({
      topRisks: [{ regulatoryRef: '' }, { regulatoryRef: 'COSSEC' }],
    });
    expect(result.score).toBe(0.5);
  });
});

// ─── Bilingual ──────────────────────────────────────────────────────────────

describe('scoreBilingual', () => {
  it('returns 1.0 when bilingual not required', () => {
    const result = scoreBilingual({}, false);
    expect(result.score).toBe(1);
  });

  it('returns 1.0 for fully bilingual output', () => {
    const result = scoreBilingual(GOOD_OUTPUT, true);
    expect(result.score).toBe(1);
  });

  it('penalises missing ES fields', () => {
    const result = scoreBilingual(
      {
        brief: 'hello',
        briefEs: '',
        topRisks: [{ finding: 'f', findingEs: '' }],
      },
      true,
    );
    expect(result.score).toBeLessThan(1);
  });
});

// ─── Format Compliance ──────────────────────────────────────────────────────

describe('scoreFormatCompliance', () => {
  it('returns 1.0 when no validator', () => {
    const result = scoreFormatCompliance({}, undefined);
    expect(result.score).toBe(1);
  });

  it('returns 1.0 when validator passes', () => {
    const result = scoreFormatCompliance({}, () => true);
    expect(result.score).toBe(1);
  });

  it('returns 0 when validator fails', () => {
    const result = scoreFormatCompliance({}, () => false);
    expect(result.score).toBe(0);
  });
});

// ─── Composite ──────────────────────────────────────────────────────────────

describe('scoreAgentRun', () => {
  it('passes for a high-quality ALM output', () => {
    const trace = makeTrace([
      'runFullSwarm',
      'runRateShock',
      'getLCR',
      'getCECL',
      'getEWS',
      'getConcentration',
    ]);
    const expected: ExpectedFindings = {
      minToolsCalled: 6,
      requiredTools: ['runFullSwarm', 'runRateShock'],
      requiresBilingual: true,
      schemaValidator: () => true,
    };
    const result = scoreAgentRun(GOOD_OUTPUT, trace, expected);
    expect(result.total).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(result.pass).toBe(true);
  });

  it('rejects weight sums != 1.0', () => {
    expect(() =>
      scoreAgentRun({}, [], {}, { ...DEFAULT_WEIGHTS, toolCoverage: 0.5 }),
    ).toThrow('weights must sum to 1.0');
  });

  it('fails for empty output', () => {
    const result = scoreAgentRun({}, [], {});
    expect(result.total).toBeLessThan(PASS_THRESHOLD);
    expect(result.pass).toBe(false);
  });
});
