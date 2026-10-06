import { z } from 'zod';
import { parseAgentOutput } from '../runner/agent-runner.service';

describe('parseAgentOutput', () => {
  const schema = z.object({ a: z.number() });

  it('accepts raw JSON', () => {
    const r = parseAgentOutput('{"a":1}', schema);
    expect(r.ok).toBe(true);
  });

  it('strips ```json fences', () => {
    const r = parseAgentOutput('```json\n{"a":1}\n```', schema);
    expect(r.ok).toBe(true);
  });

  it('plucks JSON from surrounding prose', () => {
    const r = parseAgentOutput(
      'Sure — here is the result: {"a":1} done.',
      schema,
    );
    expect(r.ok).toBe(true);
  });

  it('returns ok:false with a helpful error when nothing parses', () => {
    const r = parseAgentOutput('no json here', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema-valid/);
  });

  it('returns ok:false when JSON parses but schema rejects', () => {
    const r = parseAgentOutput('{"a":"not-a-number"}', schema);
    expect(r.ok).toBe(false);
  });

  it('handles empty string gracefully', () => {
    const r = parseAgentOutput('', schema);
    expect(r.ok).toBe(false);
  });
});
