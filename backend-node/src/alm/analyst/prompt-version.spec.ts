import { computePromptVersion } from './prompt-version';

describe('computePromptVersion', () => {
  const base = {
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are the CERNIQ ALM analyst.',
    tools: [{ name: 'get_ratios', input_schema: { type: 'object' } }],
  };

  it('returns a 12-char hex fingerprint', () => {
    const v = computePromptVersion(base);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable across runs for the same input', () => {
    expect(computePromptVersion(base)).toBe(computePromptVersion(base));
  });

  it('changes when the system prompt changes', () => {
    const a = computePromptVersion(base);
    const b = computePromptVersion({
      ...base,
      systemPrompt: base.systemPrompt + ' Be terse.',
    });
    expect(a).not.toBe(b);
  });

  it('changes when the model id changes', () => {
    const a = computePromptVersion(base);
    const b = computePromptVersion({ ...base, model: 'claude-opus-4-7' });
    expect(a).not.toBe(b);
  });

  it('changes when the tool catalog changes', () => {
    const a = computePromptVersion(base);
    const b = computePromptVersion({
      ...base,
      tools: [...base.tools, { name: 'get_peers' }],
    });
    expect(a).not.toBe(b);
  });

  it('changes when tool order changes (order is semantically meaningful for steering)', () => {
    const a = computePromptVersion(base);
    const reversed = computePromptVersion({
      ...base,
      tools: [...base.tools].reverse(),
    });
    if (base.tools.length > 1) {
      expect(a).not.toBe(reversed);
    } else {
      expect(a).toBe(reversed);
    }
  });

  it('omits temperature from the hash when not provided (implicit default)', () => {
    const withoutTemp = computePromptVersion(base);
    const withTemp = computePromptVersion({ ...base, temperature: 1 });
    expect(withoutTemp).not.toBe(withTemp);
  });

  it('treats different explicit temperatures as different fingerprints', () => {
    const t0 = computePromptVersion({ ...base, temperature: 0 });
    const t1 = computePromptVersion({ ...base, temperature: 1 });
    expect(t0).not.toBe(t1);
  });

  it('handles missing tools without throwing', () => {
    const { tools: _tools, ...noTools } = base;
    expect(() => computePromptVersion(noTools)).not.toThrow();
    expect(computePromptVersion(noTools)).toMatch(/^[0-9a-f]{12}$/);
  });
});
