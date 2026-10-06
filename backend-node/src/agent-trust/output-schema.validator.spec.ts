import { z } from 'zod';
import { OutputSchemaValidator } from './output-schema.validator';

describe('OutputSchemaValidator', () => {
  let v: OutputSchemaValidator;

  beforeEach(() => {
    v = new OutputSchemaValidator();
  });

  const riskSchema = z.object({
    topRisks: z
      .array(
        z.object({
          domain: z.string().min(1),
          dollarImpact: z.number().positive(),
          regulatoryRef: z.string().min(1),
        }),
      )
      .min(1),
    healthScore: z.object({
      score: z.number().min(0).max(100),
      label: z.string(),
    }),
  });

  it('returns ok + typed data on valid input', () => {
    const result = v.validate(riskSchema, {
      topRisks: [
        {
          domain: 'Rate Risk',
          dollarImpact: 2_400_000,
          regulatoryRef: '12 CFR 741.3',
        },
      ],
      healthScore: { score: 62, label: 'SATISFACTORY' },
    });
    expect(result.ok).toBe(true);
    expect(result.data!.topRisks[0].domain).toBe('Rate Risk');
    expect(result.violations).toEqual([]);
  });

  it('BLOCKs on missing required field', () => {
    const result = v.validate(riskSchema, {
      topRisks: [{ domain: 'Rate Risk', dollarImpact: 2_400_000 }],
      healthScore: { score: 62, label: 'SATISFACTORY' },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0].rule).toBe('OUTPUT_SCHEMA_INVALID');
    expect(result.violations[0].severity).toBe('BLOCK');
  });

  it('BLOCKs on negative dollarImpact (positive required)', () => {
    const result = v.validate(riskSchema, {
      topRisks: [{ domain: 'Rate', dollarImpact: -1, regulatoryRef: '12 CFR' }],
      healthScore: { score: 50, label: 'OK' },
    });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes('dollarImpact')),
    ).toBe(true);
  });

  it('BLOCKs on empty topRisks array', () => {
    const result = v.validate(riskSchema, {
      topRisks: [],
      healthScore: { score: 50, label: 'OK' },
    });
    expect(result.ok).toBe(false);
  });

  it('BLOCKs on health score > 100', () => {
    const result = v.validate(riskSchema, {
      topRisks: [{ domain: 'Rate', dollarImpact: 100, regulatoryRef: 'X' }],
      healthScore: { score: 150, label: 'INVALID' },
    });
    expect(result.ok).toBe(false);
  });

  it('reports path in violation message', () => {
    const result = v.validate(riskSchema, {
      topRisks: 'not-an-array',
      healthScore: {},
    });
    const msg = result.violations.map((v) => v.message).join('\n');
    expect(msg).toMatch(/topRisks/);
  });

  it('handles null/undefined input gracefully', () => {
    const result = v.validate(riskSchema, null);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
