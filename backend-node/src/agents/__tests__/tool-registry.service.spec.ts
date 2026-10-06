import { z } from 'zod';
import { ToolRegistryService } from '../registry/tool-registry.service';
import { defineTool } from '../registry/tool.types';
import type { ToolContext } from '../registry/tool.types';

// The registry itself is agnostic of the ALM tools — we inject a stub
// factory so the behaviour under test (validation, timeout, error envelope
// shape) is exercised without booting the ALM stack.

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: 'run_test',
    agentId: 'ALM_DECISION',
    institutionId: 'inst_1',
    organizationId: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function build(tools: any[]) {
  const factory = { build: () => tools } as any;
  const svc = new ToolRegistryService(factory);
  svc.onModuleInit();
  return svc;
}

describe('ToolRegistryService', () => {
  it('loads tools and exposes them via list()', () => {
    const echo = defineTool({
      name: 'echo',
      description: 'echo',
      input: z.object({ v: z.string() }),
      output: z.object({ v: z.string() }),
      handler: async (i) => i,
    });
    const svc = build([echo]);
    expect(svc.list().map((t) => t.name)).toEqual(['echo']);
    expect(svc.has('echo')).toBe(true);
  });

  it('rejects duplicate tool names at load time', () => {
    const dup = defineTool({
      name: 'dup',
      description: 'x',
      input: z.object({}),
      output: z.object({}),
      handler: async () => ({}),
    });
    const factory = { build: () => [dup, dup] } as any;
    const svc = new ToolRegistryService(factory);
    expect(() => svc.onModuleInit()).toThrow(/duplicate tool name/);
  });

  it('returns TOOL_UNAVAILABLE for unknown tools', async () => {
    const svc = build([]);
    const out = await svc.invoke('nope', {}, ctx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('TOOL_UNAVAILABLE');
  });

  it('validates input with Zod', async () => {
    const t = defineTool({
      name: 't',
      description: 'x',
      input: z.object({ n: z.number() }),
      output: z.object({ n: z.number() }),
      handler: async (i) => i,
    });
    const svc = build([t]);
    const out = await svc.invoke('t', { n: 'not-a-number' }, ctx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('TOOL_INPUT_INVALID');
  });

  it('validates output with Zod (catches drift in the service layer)', async () => {
    const t = defineTool({
      name: 't',
      description: 'x',
      input: z.object({}),
      output: z.object({ n: z.number() }),
      handler: async () => ({ n: 'bad' }) as any,
    });
    const svc = build([t]);
    const out = await svc.invoke('t', {}, ctx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('TOOL_OUTPUT_INVALID');
  });

  it('enforces timeoutMs and surfaces TOOL_TIMEOUT', async () => {
    const t = defineTool({
      name: 'slow',
      description: 'x',
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      timeoutMs: 20,
      handler: () =>
        new Promise<{ ok: true }>((r) =>
          setTimeout(() => r({ ok: true }), 200),
        ),
    });
    const svc = build([t]);
    const out = await svc.invoke('slow', {}, ctx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('TOOL_TIMEOUT');
  });

  it('captures provenance and duration on success', async () => {
    const t = defineTool({
      name: 'fast',
      description: 'x',
      input: z.object({}),
      output: z.object({ v: z.number() }),
      handler: async () => ({ v: 1 }),
    });
    const svc = build([t]);
    const out = await svc.invoke('fast', {}, ctx());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.provenance).toEqual(['fast']);
      expect(out.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
