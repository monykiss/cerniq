import { z } from 'zod';
import { AgentTrustService } from './agent-trust.service';
import type { AgentAuditLogReadModel, AgentRunReadModel } from './contracts';
import { HedgeLanguageDetector } from './hedge-language.detector';
import { NumberCitationValidator } from './number-citation.validator';
import { OutputSchemaValidator } from './output-schema.validator';
import { PiiRedactorService } from './pii-redactor.service';
import { PromptInjectionShield } from './prompt-injection.shield';

const run: AgentRunReadModel = {
  id: 'run-1',
  institutionId: 'inst-1',
  agentType: 'ALM_DECISION',
  status: 'RUNNING',
  input: {},
  output: null,
  modelVersion: 'claude-opus-4-6',
};

const trace = (toolOutputs: unknown[]): AgentAuditLogReadModel[] =>
  toolOutputs.map((toolOutput, i) => ({
    id: `step-${i}`,
    runId: 'run-1',
    stepNumber: i,
    stepType: 'TOOL_CALL',
    toolName: `t-${i}`,
    toolInput: null,
    toolOutput: toolOutput as Record<string, unknown>,
    llmPrompt: null,
    llmOutput: null,
    durationMs: 5,
  }));

const almOutputSchema = z.object({
  topRisks: z.array(
    z.object({
      domain: z.string(),
      dollarImpact: z.number().positive(),
      regulatoryRef: z.string().min(1),
    }),
  ),
});

const make = (): AgentTrustService =>
  new AgentTrustService(
    new NumberCitationValidator(),
    new PiiRedactorService(),
    new PromptInjectionShield(),
    new HedgeLanguageDetector(),
    new OutputSchemaValidator(),
  );

describe('AgentTrustService', () => {
  it('passes a clean, fully-cited, schema-valid ALM output', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText:
        'Top risk: rate risk. NII impact at +200bps: -$2,400,000. LCR 118.5%, well above 115% threshold.',
      agentOutput: {
        topRisks: [
          {
            domain: 'Interest Rate Risk',
            dollarImpact: 2_400_000,
            regulatoryRef: '12 CFR 741.3',
          },
        ],
      },
      trace: trace([
        {
          rateShock: { scenarioBps: 200, up200bps: { nii: -2_400_000 } },
          liquidity: { lcr: 118.5, threshold: 115 },
        },
      ]),
      outputSchema: almOutputSchema,
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.summary.block).toBe(0);
  });

  it('BLOCKS on uncited number + schema violation, aggregates both', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText: 'NII would fall by $9,999,999 next quarter.',
      agentOutput: {
        topRisks: [{ domain: 'Rate', dollarImpact: -1, regulatoryRef: '' }],
      },
      trace: trace([{ rateShock: { up200bps: { nii: -1_000_000 } } }]),
      outputSchema: almOutputSchema,
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.summary.block).toBeGreaterThanOrEqual(2);
    const rules = new Set(verdict.violations.map((v) => v.rule));
    expect(rules.has('NUMBER_NOT_CITED')).toBe(true);
    expect(rules.has('OUTPUT_SCHEMA_INVALID')).toBe(true);
  });

  it('BLOCKS on PII leak in agent text', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText: 'Contact CFO at 123-45-6789 regarding exposure.',
      agentOutput: { topRisks: [] },
      trace: [],
      outputSchema: almOutputSchema,
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.violations.some((v) => v.rule === 'PII_LEAK')).toBe(true);
  });

  it('BLOCKS missing bilingual for PR institutions', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText:
        'Rate risk is elevated. Recommend hedging duration by 0.4 years.',
      agentOutput: { topRisks: [] },
      trace: [],
      outputSchema: almOutputSchema,
      requiredLanguage: 'bilingual',
    });

    expect(verdict.violations.some((v) => v.rule === 'MISSING_BILINGUAL')).toBe(
      true,
    );
  });

  it('WARNs but does not block on over-length', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText: 'word '.repeat(700),
      agentOutput: { topRisks: [] },
      trace: [],
      outputSchema: almOutputSchema,
      maxWords: 600,
    });

    const overLength = verdict.violations.find((v) => v.rule === 'OVER_LENGTH');
    expect(overLength).toBeDefined();
    expect(overLength!.severity).toBe('WARN');
  });

  it('records evaluatedInMs', () => {
    const svc = make();
    const verdict = svc.evaluate({
      run,
      agentText: '',
      agentOutput: { topRisks: [] },
      trace: [],
      outputSchema: almOutputSchema,
    });
    expect(verdict.evaluatedInMs).toBeGreaterThanOrEqual(0);
  });
});
