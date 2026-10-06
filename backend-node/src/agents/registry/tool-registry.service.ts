import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ToolDescriptor, ToolContext, ToolOutcome } from './tool.types';
import { AlmToolsFactory } from './tools/alm-tools';

// ToolRegistryService is the single source of truth for which tools exist and
// how to call them. It is deliberately tiny: validate → time → handler →
// validate-output → envelope. No retries, no caching, no transforms — those
// live in the runner so this remains trivially testable.

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDescriptor>();

  constructor(private readonly almTools: AlmToolsFactory) {}

  onModuleInit(): void {
    for (const tool of this.almTools.build()) {
      if (this.tools.has(tool.name)) {
        throw new Error(`duplicate tool name in registry: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
    this.logger.log(
      `tool registry loaded: ${this.tools.size} tools (${Array.from(this.tools.keys()).sort().join(', ')})`,
    );
  }

  list(): ReadonlyArray<ToolDescriptor> {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  /// LLM function-calling descriptor subset. We expose only `name`,
  /// `description`, and a JSON-schema-ish input shape so the provider
  /// adapter can pass it through untouched.
  describeForLLM(allowList?: ReadonlySet<string>): Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }> {
    return this.list()
      .filter((t) => !allowList || allowList.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: zodToJsonSchema(t.input),
      }));
  }

  async invoke(
    name: string,
    rawInput: unknown,
    ctx: ToolContext,
  ): Promise<ToolOutcome> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        name,
        code: 'TOOL_UNAVAILABLE',
        message: `unknown tool: ${name}`,
        durationMs: 0,
      };
    }

    const parsedInput = tool.input.safeParse(rawInput ?? {});
    if (!parsedInput.success) {
      return {
        ok: false,
        name,
        code: 'TOOL_INPUT_INVALID',
        message: `input validation failed for ${name}`,
        hint: parsedInput.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; '),
        durationMs: Date.now() - started,
      };
    }

    const timeoutMs = tool.timeoutMs ?? 10_000;
    try {
      const raw = await this.runWithTimeout(
        tool.handler(parsedInput.data, ctx),
        timeoutMs,
        ctx.signal,
      );
      const parsedOutput = tool.output.safeParse(raw);
      if (!parsedOutput.success) {
        return {
          ok: false,
          name,
          code: 'TOOL_OUTPUT_INVALID',
          message: `output validation failed for ${name}`,
          hint: parsedOutput.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; '),
          durationMs: Date.now() - started,
        };
      }
      return {
        ok: true,
        data: parsedOutput.data,
        durationMs: Date.now() - started,
        provenance: [name],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - started;
      if (message === '__TOOL_TIMEOUT__') {
        return {
          ok: false,
          name,
          code: 'TOOL_TIMEOUT',
          message: `tool ${name} exceeded ${timeoutMs}ms`,
          durationMs,
        };
      }
      if (message.startsWith('TOOL_INPUT_INVALID:')) {
        return {
          ok: false,
          name,
          code: 'TOOL_INPUT_INVALID',
          message: message.replace(/^TOOL_INPUT_INVALID:\s*/, ''),
          durationMs,
        };
      }
      this.logger.error(`tool ${name} failed`, err as Error);
      return {
        ok: false,
        name,
        code: 'TOOL_INTERNAL_ERROR',
        message: `tool ${name} threw an unexpected error`,
        durationMs,
      };
    }
  }

  private async runWithTimeout<T>(
    promise: Promise<T>,
    ms: number,
    parentSignal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('__TOOL_TIMEOUT__')), ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('__TOOL_TIMEOUT__'));
      };
      if (parentSignal.aborted) {
        clearTimeout(timer);
        return reject(new Error('__TOOL_TIMEOUT__'));
      }
      parentSignal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (v) => {
          clearTimeout(timer);
          parentSignal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          parentSignal.removeEventListener('abort', onAbort);
          // Normalize rejection value to Error so downstream handlers
          // get a consistent shape (message, stack). Satisfies
          // prefer-promise-reject-errors.
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
}

// Minimal Zod → JSON-schema converter. We intentionally do not pull in the
// `zod-to-json-schema` dep to keep the agents module self-contained; the
// LLM provider only needs top-level field names, types, and descriptions.
// Any Zod feature not listed below (unions, records, refinements) degrades
// gracefully to "type: object".
function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  const def: any = (schema as any)._def;
  const t = def?.typeName;
  switch (t) {
    case 'ZodObject': {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v as z.ZodTypeAny);
        if (!(v as any).isOptional?.()) required.push(k);
      }
      return {
        type: 'object',
        properties,
        required: required.length ? required : undefined,
        additionalProperties: false,
      };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def.type) };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType);
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType);
    case 'ZodUnion':
      return { oneOf: def.options.map(zodToJsonSchema) };
    default:
      return { type: 'object' };
  }
}
