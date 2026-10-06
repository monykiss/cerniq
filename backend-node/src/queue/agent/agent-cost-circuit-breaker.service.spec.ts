import { AgentCostCircuitBreakerService } from './agent-cost-circuit-breaker.service';

function buildService(capCents: string | undefined = '10000') {
  const originalEnv = process.env.LLM_COST_CAP_USD_CENTS;
  process.env.LLM_COST_CAP_USD_CENTS = capCents as any;

  const prisma = {
    agentRun: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsdCents: 0 } }),
    },
  };
  const svc = new AgentCostCircuitBreakerService(prisma as any);

  return {
    svc,
    prisma,
    cleanup: () => {
      if (originalEnv !== undefined) {
        process.env.LLM_COST_CAP_USD_CENTS = originalEnv;
      } else {
        delete process.env.LLM_COST_CAP_USD_CENTS;
      }
    },
  };
}

describe('AgentCostCircuitBreakerService', () => {
  it('allows when spend is under cap', async () => {
    const { svc, prisma, cleanup } = buildService('10000');
    prisma.agentRun.aggregate.mockResolvedValue({
      _sum: { costUsdCents: 5000 },
    });
    const result = await svc.isAllowed('inst_1');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('OK');
    expect(result.spentCents).toBe(5000);
    cleanup();
  });

  it('warns at 80% threshold', async () => {
    const { svc, prisma, cleanup } = buildService('10000');
    prisma.agentRun.aggregate.mockResolvedValue({
      _sum: { costUsdCents: 8500 },
    });
    const result = await svc.isAllowed('inst_1');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('WARN');
    cleanup();
  });

  it('blocks at 100% threshold', async () => {
    const { svc, prisma, cleanup } = buildService('10000');
    prisma.agentRun.aggregate.mockResolvedValue({
      _sum: { costUsdCents: 10000 },
    });
    const result = await svc.isAllowed('inst_1');
    expect(result.allowed).toBe(false);
    expect(result.state).toBe('BLOCKED');
    cleanup();
  });

  it('returns snapshot with remaining budget', () => {
    const { svc, cleanup } = buildService('10000');
    const snap = svc.snapshotForInstitution('inst_1', 7000);
    expect(snap.capUsdCents).toBe(10000);
    expect(snap.remainingUsdCents).toBe(3000);
    expect(snap.state).toBe('OK');
    cleanup();
  });

  it('remaining never goes negative', () => {
    const { svc, cleanup } = buildService('10000');
    const snap = svc.snapshotForInstitution('inst_1', 15000);
    expect(snap.remainingUsdCents).toBe(0);
    expect(snap.state).toBe('BLOCKED');
    cleanup();
  });

  it('queries only current month spend', async () => {
    const { svc, prisma, cleanup } = buildService('10000');
    await svc.isAllowed('inst_1');
    const call = prisma.agentRun.aggregate.mock.calls[0][0];
    expect(call.where.institutionId).toBe('inst_1');
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    const monthStart = call.where.createdAt.gte as Date;
    expect(monthStart.getUTCDate()).toBe(1);
    cleanup();
  });

  // ── Env resolution table ─────────────────────────────────────────
  // Honors the documented .env.example name (LLM_COST_ALERT_THRESHOLD_USD)
  // AND the precise legacy name (LLM_COST_CAP_USD_CENTS). Cents takes
  // precedence when both are set. Previously only cents was honored
  // silently — an operator editing the documented USD var saw no
  // effect, and a typo in cents silently disabled the breaker.
  describe('resolveCapCents', () => {
    const resolve = (env: Record<string, string | undefined>) =>
      AgentCostCircuitBreakerService.resolveCapCents(env as NodeJS.ProcessEnv);

    it('defaults to 10000 cents ($100) when both env vars are unset', () => {
      expect(resolve({})).toBe(10000);
    });

    it('honors LLM_COST_CAP_USD_CENTS precisely', () => {
      expect(resolve({ LLM_COST_CAP_USD_CENTS: '25000' })).toBe(25000);
    });

    it('honors LLM_COST_ALERT_THRESHOLD_USD in USD', () => {
      expect(resolve({ LLM_COST_ALERT_THRESHOLD_USD: '250' })).toBe(25000);
    });

    it('converts fractional USD with rounding (no float drift)', () => {
      // 100.1 USD * 100 = 10010.000000000002 in IEEE-754. Must round.
      expect(resolve({ LLM_COST_ALERT_THRESHOLD_USD: '100.1' })).toBe(10010);
    });

    it('prefers LLM_COST_CAP_USD_CENTS over LLM_COST_ALERT_THRESHOLD_USD when both are set', () => {
      expect(
        resolve({
          LLM_COST_CAP_USD_CENTS: '30000',
          LLM_COST_ALERT_THRESHOLD_USD: '99',
        }),
      ).toBe(30000);
    });

    it('returns null (disabled) on malformed LLM_COST_CAP_USD_CENTS', () => {
      expect(resolve({ LLM_COST_CAP_USD_CENTS: 'abc' })).toBeNull();
      expect(resolve({ LLM_COST_CAP_USD_CENTS: '-5' })).toBeNull();
      // Non-integer cents is rejected — cents is by definition integer.
      expect(resolve({ LLM_COST_CAP_USD_CENTS: '10.5' })).toBeNull();
    });

    it('returns null (disabled) on malformed LLM_COST_ALERT_THRESHOLD_USD', () => {
      expect(resolve({ LLM_COST_ALERT_THRESHOLD_USD: 'abc' })).toBeNull();
      expect(resolve({ LLM_COST_ALERT_THRESHOLD_USD: '-1' })).toBeNull();
    });
  });
});
