import {
  canonicalJson,
  chainHash,
  AgentAuditService,
} from '../runner/agent-audit.service';

// ─── pure helpers (no DB) ──────────────────────────────────────────────

describe('canonicalJson', () => {
  it('emits keys in sorted order regardless of insertion order', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, a: 2 } });
    const b = canonicalJson({ a: 2, c: { a: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array ordering', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('x')).toBe('"x"');
  });
});

describe('chainHash', () => {
  const base = {
    prevHash: null,
    runId: 'run_abc',
    stepIndex: 0,
    stepKind: 'RUN_STARTED',
    payloadJson: '{"a":1}',
  };

  it('is deterministic', () => {
    expect(chainHash(base)).toBe(chainHash(base));
  });

  it('changes when any field changes', () => {
    const h0 = chainHash(base);
    expect(chainHash({ ...base, stepIndex: 1 })).not.toBe(h0);
    expect(chainHash({ ...base, runId: 'run_xyz' })).not.toBe(h0);
    expect(chainHash({ ...base, payloadJson: '{"a":2}' })).not.toBe(h0);
    expect(chainHash({ ...base, prevHash: h0 })).not.toBe(h0);
  });

  it('produces a 64-char hex digest', () => {
    expect(chainHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── service-level verify flow (in-memory Prisma mock) ────────────────

describe('AgentAuditService.verifyChain', () => {
  function buildMockPrisma(rows: any[]) {
    return {
      agentAuditLog: {
        findMany: jest.fn().mockResolvedValue(rows),
        findFirst: jest.fn().mockResolvedValue(rows[rows.length - 1] ?? null),
        create: jest.fn(),
      },
    } as any;
  }

  function buildChain(runId: string, payloads: unknown[]) {
    const rows: any[] = [];
    let prevHash: string | null = null;
    payloads.forEach((payload, i) => {
      const payloadJson = canonicalJson(payload);
      const hash = chainHash({
        prevHash,
        runId,
        stepIndex: i,
        stepKind: 'LLM_TURN',
        payloadJson,
      });
      rows.push({
        runId,
        stepIndex: i,
        stepKind: 'LLM_TURN',
        payload,
        prevHash,
        hash,
      });
      prevHash = hash;
    });
    return rows;
  }

  it('returns ok for a well-formed chain', async () => {
    const rows = buildChain('run1', [{ a: 1 }, { a: 2 }, { a: 3 }]);
    const svc = new AgentAuditService(buildMockPrisma(rows));
    await expect(svc.verifyChain('run1')).resolves.toEqual({ ok: true });
  });

  it('detects a mutated payload mid-chain', async () => {
    const rows = buildChain('run1', [{ a: 1 }, { a: 2 }, { a: 3 }]);
    rows[1].payload = { a: 999 };
    const svc = new AgentAuditService(buildMockPrisma(rows));
    await expect(svc.verifyChain('run1')).resolves.toEqual({
      ok: false,
      brokenAtIndex: 1,
    });
  });

  it('detects a reordered chain', async () => {
    const rows = buildChain('run1', [{ a: 1 }, { a: 2 }, { a: 3 }]);
    [rows[1], rows[2]] = [rows[2], rows[1]];
    const svc = new AgentAuditService(buildMockPrisma(rows));
    const result = await svc.verifyChain('run1');
    expect(result.ok).toBe(false);
  });
});
