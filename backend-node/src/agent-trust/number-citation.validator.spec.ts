import type { AgentAuditLogReadModel } from './contracts';
import { NumberCitationValidator } from './number-citation.validator';

const trace = (toolOutputs: unknown[]): AgentAuditLogReadModel[] =>
  toolOutputs.map((toolOutput, i) => ({
    id: `step-${i}`,
    runId: 'run-1',
    stepNumber: i,
    stepType: 'TOOL_CALL',
    toolName: `tool-${i}`,
    toolInput: null,
    toolOutput: toolOutput as Record<string, unknown>,
    llmPrompt: null,
    llmOutput: null,
    durationMs: 10,
  }));

describe('NumberCitationValidator', () => {
  let v: NumberCitationValidator;

  beforeEach(() => {
    v = new NumberCitationValidator();
  });

  describe('extractClaims', () => {
    it('parses currency in common formats', () => {
      const claims = v.extractClaims(
        'Net interest income would fall $1,234,567 at +200bps. Pre-tax income: $1.2M.',
      );
      const values = claims.map((c) => c.value).sort((a, b) => a - b);
      expect(values).toContain(1_234_567);
      expect(values).toContain(1_200_000);
    });

    it('parses percent and bps', () => {
      const claims = v.extractClaims(
        'LCR 118.5% against threshold 115%, gap 175bps.',
      );
      const pct = claims
        .filter((c) => c.kind === 'percent')
        .map((c) => c.value);
      const bps = claims.filter((c) => c.kind === 'bps').map((c) => c.value);
      expect(pct.sort((a, b) => a - b)).toEqual([115, 118.5]);
      expect(bps).toEqual([175]);
    });

    it('ignores four-digit years', () => {
      const claims = v.extractClaims(
        'As of 2026-04-15 the NII was $5,000,000.',
      );
      expect(claims.find((c) => c.value === 2026)).toBeUndefined();
      expect(claims.find((c) => c.value === 5_000_000)).toBeDefined();
    });

    it('ignores immaterial plain counts', () => {
      const claims = v.extractClaims(
        'Step 5 completed; found 12 exposures above threshold.',
      );
      expect(claims).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('passes when every number is cited (±1%)', () => {
      const t = trace([{ nii: 1_234_567, lcr: 118.5 }]);
      const out = 'NII falls by $1,234,567; LCR stands at 118.5%.';
      expect(v.validate(out, t)).toEqual([]);
    });

    it('passes when claim differs by <1%', () => {
      const t = trace([{ nii: 1_240_000 }]);
      const out = 'NII falls by $1.23M.';
      const violations = v.validate(out, t);
      expect(violations).toEqual([]);
    });

    it('BLOCKS a number that has no tool citation', () => {
      const t = trace([{ liquidity: { lcr: 118.5 } }]);
      const out =
        'We estimate dollar impact of $7,500,000 in the stress scenario.';
      const violations = v.validate(out, t);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NUMBER_NOT_CITED');
      expect(violations[0].severity).toBe('BLOCK');
      expect((violations[0].evidence as { value: number }).value).toBe(
        7_500_000,
      );
    });

    it('descends into nested tool output shapes', () => {
      const t = trace([
        {
          swarm: {
            rateShock: { scenarioBps: 200, up200bps: { nii: -2_400_000 } },
            liquidity: { lcr: 118.5, nsfr: 109.4 },
          },
        },
      ]);
      const out = 'NII at +200bps: -$2,400,000. LCR 118.5%, NSFR 109.4%.';
      expect(v.validate(out, t)).toEqual([]);
    });

    it('reports nearest cited value as evidence', () => {
      const t = trace([{ nii: 1_000_000 }]);
      const out = 'NII falls by $5,000,000.';
      const [violation] = v.validate(out, t);
      expect(
        (violation.evidence as { nearestCited: number }).nearestCited,
      ).toBe(1_000_000);
    });

    it('tolerance is configurable', () => {
      const looser = new NumberCitationValidator(0.1); // ±10%
      const t = trace([{ nii: 1_000_000 }]);
      const out = 'NII falls by $1,050,000.'; // 5% off → passes at 10% tol
      expect(looser.validate(out, t)).toEqual([]);
    });
  });
});
