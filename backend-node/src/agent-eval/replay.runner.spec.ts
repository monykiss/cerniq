import { z } from 'zod';
import { AgentTrustService } from '../agent-trust/agent-trust.service';
import { HedgeLanguageDetector } from '../agent-trust/hedge-language.detector';
import { NumberCitationValidator } from '../agent-trust/number-citation.validator';
import { OutputSchemaValidator } from '../agent-trust/output-schema.validator';
import { PiiRedactorService } from '../agent-trust/pii-redactor.service';
import { PromptInjectionShield } from '../agent-trust/prompt-injection.shield';
import type { TrustVerdict } from '../agent-trust/contracts';
import type { AgentRunResult } from './contracts';
import { ReplayRunnerService } from './replay.runner';

const makeTrust = () =>
  new AgentTrustService(
    new NumberCitationValidator(),
    new PiiRedactorService(),
    new PromptInjectionShield(),
    new HedgeLanguageDetector(),
    new OutputSchemaValidator(),
  );

const almSchema = z.object({
  topRisks: z.array(
    z.object({
      domain: z.string(),
      dollarImpact: z.number().optional(),
      regulatoryRef: z.string().optional(),
    }),
  ),
});

const goodResult: AgentRunResult = {
  runId: 'r-1',
  institutionId: 'i-1',
  agentType: 'ALM_DECISION',
  narrative: 'NII falls by $2,400,000 at +200bps. LCR 118.5%.',
  output: { topRisks: [{ domain: 'Rate Risk', dollarImpact: 2_400_000 }] },
  trace: [
    {
      id: 's1',
      runId: 'r-1',
      stepNumber: 1,
      stepType: 'TOOL_CALL',
      toolName: 'runRateShock',
      toolInput: null,
      toolOutput: { scenarioBps: 200, nii: -2_400_000, lcr: 118.5 },
      llmPrompt: null,
      llmOutput: null,
      durationMs: 100,
    },
  ],
  computeMs: 1000,
};

const goodVerdict: TrustVerdict = {
  pass: true,
  violations: [],
  summary: { block: 0, warn: 0, info: 0 },
  evaluatedInMs: 5,
};

describe('ReplayRunnerService', () => {
  let svc: ReplayRunnerService;

  beforeEach(() => {
    svc = new ReplayRunnerService(makeTrust());
  });

  it('returns matching outcome when trust layer is stable', () => {
    const report = svc.replay(goodResult, goodVerdict, {
      outputSchema: almSchema,
    });

    expect(report.outcomeMatches).toBe(true);
    expect(report.currentVerdict.pass).toBe(true);
    expect(report.newViolations).toEqual([]);
    expect(report.clearedViolations).toEqual([]);
  });

  it('detects outcome drift when original was PASS but current is BLOCK', () => {
    const resultWithPII: AgentRunResult = {
      ...goodResult,
      narrative: 'CFO SSN 123-45-6789 NII falls by $2,400,000.',
    };
    const report = svc.replay(resultWithPII, goodVerdict, {
      outputSchema: almSchema,
    });

    expect(report.outcomeMatches).toBe(false);
    expect(report.currentVerdict.pass).toBe(false);
    expect(report.newViolations.length).toBeGreaterThan(0);
  });

  it('detects cleared violations (original had, current does not)', () => {
    const verdictWithFalsePositive: TrustVerdict = {
      pass: false,
      violations: [
        {
          rule: 'HEDGE_LANGUAGE',
          severity: 'WARN',
          message: 'old hedge',
          location: { start: 0, end: 3 },
        },
      ],
      summary: { block: 0, warn: 1, info: 0 },
      evaluatedInMs: 5,
    };
    const report = svc.replay(goodResult, verdictWithFalsePositive, {
      outputSchema: almSchema,
    });

    expect(report.clearedViolations.length).toBeGreaterThan(0);
  });

  it('handles null prior verdict (first-ever replay)', () => {
    const report = svc.replay(goodResult, null, { outputSchema: almSchema });

    expect(report.originalVerdict).toBeNull();
    expect(report.outcomeMatches).toBe(false);
    expect(report.currentVerdict.pass).toBe(true);
  });

  it('includes bilingual check when requiredLanguage is set', () => {
    const report = svc.replay(goodResult, goodVerdict, {
      outputSchema: almSchema,
      requiredLanguage: 'bilingual',
    });

    expect(
      report.currentVerdict.violations.some(
        (v) => v.rule === 'MISSING_BILINGUAL',
      ),
    ).toBe(true);
    expect(report.outcomeMatches).toBe(false);
  });
});
