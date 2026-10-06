import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import type { TrustViolation } from './contracts';

/**
 * Vol2 LLM Security rule #3: "All LLM outputs are validated against the output
 * schema before being persisted. Invalid schema = run fails."
 *
 * Thin wrapper over Zod. Callers register a schema per agent type; this
 * service is the single entry point so schema failures are logged and shaped
 * into {@link TrustViolation} alongside the other trust checks.
 */

export interface OutputSchemaResult<T> {
  ok: boolean;
  data?: T;
  violations: TrustViolation[];
}

@Injectable()
export class OutputSchemaValidator {
  private readonly logger = new Logger(OutputSchemaValidator.name);

  validate<T>(schema: ZodType<T>, candidate: unknown): OutputSchemaResult<T> {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return { ok: true, data: parsed.data, violations: [] };
    const violations = parsed.error.issues.map<TrustViolation>((issue) => ({
      rule: 'OUTPUT_SCHEMA_INVALID',
      severity: 'BLOCK',
      message: `Output schema violation at ${issue.path.join('.') || '<root>'}: ${issue.message}`,
      evidence: {
        path: issue.path,
        code: issue.code,
      },
    }));
    return { ok: false, violations };
  }
}
