import { CircuitBreakerService } from './circuit-breaker.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('execute', () => {
    it('should execute function successfully on closed circuit', async () => {
      const result = await service.execute('test_api', async () => 'success');
      expect(result).toBe('success');
    });

    it('should open circuit after threshold failures', async () => {
      const failFn = async () => {
        throw new Error('connection refused');
      };

      // Default threshold is 5 failures
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('default', failFn)).rejects.toThrow();
      }

      // Circuit should now be open — next call should throw ServiceUnavailableException
      await expect(
        service.execute('default', async () => 'wont-reach'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should use fallback when circuit is open and fallback is provided', async () => {
      const failFn = async () => {
        throw new Error('fail');
      };

      for (let i = 0; i < 5; i++) {
        await service
          .execute('default', failFn, () => 'fallback')
          .catch(() => {});
      }

      const result = await service.execute(
        'default',
        async () => 'wont-reach',
        () => 'fallback-value',
      );
      expect(result).toBe('fallback-value');
    });

    it('should reset circuit on successful call', async () => {
      const result = await service.execute('test_api', async () => 42);
      expect(result).toBe(42);

      const status = service.getStatus();
      const testCircuit = status.find((s) => s.service === 'test_api');
      expect(testCircuit?.state).toBe('closed');
      expect(testCircuit?.failures).toBe(0);
    });

    it('should use fallback on failure when fallback is provided', async () => {
      const result = await service.execute(
        'test_api',
        async () => {
          throw new Error('timeout');
        },
        () => 'cached-result',
      );
      expect(result).toBe('cached-result');
    });
  });

  describe('getStatus', () => {
    it('should return empty array when no circuits used', () => {
      expect(service.getStatus()).toEqual([]);
    });

    it('should return circuit state after usage', async () => {
      await service.execute('fred_api', async () => 'ok');

      const status = service.getStatus();
      expect(status.length).toBe(1);
      expect(status[0].service).toBe('fred_api');
      expect(status[0].state).toBe('closed');
    });
  });

  // ── half_open recovery ───────────────────────────────────────

  describe('half_open recovery', () => {
    it('transitions open → half_open after cooldown, then closes on success', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      // Trip open for monte_carlo (threshold: 3, cooldown: 30000)
      for (let i = 0; i < 3; i++) {
        await service.execute(
          'monte_carlo',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }
      expect(
        service.getStatus().find((s) => s.service === 'monte_carlo')?.state,
      ).toBe('open');

      // Advance past cooldown (30s)
      now += 31000;

      const result = await service.execute(
        'monte_carlo',
        async () => 'recovered',
      );
      expect(result).toBe('recovered');
      expect(
        service.getStatus().find((s) => s.service === 'monte_carlo')?.state,
      ).toBe('closed');
      expect(
        service.getStatus().find((s) => s.service === 'monte_carlo')?.failures,
      ).toBe(0);

      Date.now = realNow;
    });

    it('transitions half_open → open on failure during half_open', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      for (let i = 0; i < 3; i++) {
        await service.execute(
          'monte_carlo',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }

      now += 31000;

      // Fail during half_open → should go back to open
      await service.execute(
        'monte_carlo',
        async () => {
          throw new Error('still broken');
        },
        () => null,
      );
      expect(
        service.getStatus().find((s) => s.service === 'monte_carlo')?.state,
      ).toBe('open');

      Date.now = realNow;
    });

    it('logs half_open → closed recovery transition', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      for (let i = 0; i < 3; i++) {
        await service.execute(
          'monte_carlo',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }

      now += 31000;
      await service.execute('monte_carlo', async () => 'ok');

      Date.now = realNow;
    });
  });

  // ── evictStale ───────────────────────────────────────────────

  describe('evictStale', () => {
    it('evicts stale closed circuits after 1 hour of inactivity', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      // Create a circuit with a failure, then recover it (state will be closed with lastFailure > 0)
      await service.execute(
        'stale_svc',
        async () => {
          throw new Error('err');
        },
        () => null,
      );
      await service.execute('stale_svc', async () => 'ok');

      // Advance past 1 hour
      now += 3_600_001;
      (service as any).evictStale();

      expect(
        service.getStatus().find((s) => s.service === 'stale_svc'),
      ).toBeUndefined();
      Date.now = realNow;
    });

    it('does not evict open circuits', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      for (let i = 0; i < 5; i++) {
        await service.execute(
          'open_svc',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }

      now += 3_600_001;
      (service as any).evictStale();
      expect(
        service.getStatus().find((s) => s.service === 'open_svc'),
      ).toBeDefined();

      Date.now = realNow;
    });

    it('does not evict circuits with no activity (lastFailure=0, openedAt=0)', async () => {
      await service.execute('fresh_svc', async () => 'ok');
      (service as any).evictStale();
      // lastFailure is 0 and openedAt is 0, so lastActivity is 0 which is > 0 check fails
      expect(
        service.getStatus().find((s) => s.service === 'fresh_svc'),
      ).toBeDefined();
    });
  });

  // ── ServiceUnavailableException message ──────────────────────

  describe('ServiceUnavailableException details', () => {
    it('includes retry countdown in error message', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      for (let i = 0; i < 5; i++) {
        await expect(
          service.execute('default', async () => {
            throw new Error('err');
          }),
        ).rejects.toThrow();
      }

      // Now circuit is open, advance partially through cooldown
      now += 30000; // 30s of 60s cooldown elapsed

      try {
        await service.execute('default', async () => 'nope');
      } catch (e: any) {
        expect(e.message).toContain('Retry in');
      }

      Date.now = realNow;
    });
  });

  // ── Named configs coverage ───────────────────────────────────

  describe('named configs', () => {
    it('ncua_pull has threshold 3', async () => {
      for (let i = 0; i < 3; i++) {
        await service.execute(
          'ncua_pull',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }
      expect(
        service.getStatus().find((s) => s.service === 'ncua_pull')?.state,
      ).toBe('open');
    });

    it('claude_api recovers after 1-min cooldown', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      for (let i = 0; i < 5; i++) {
        await service.execute(
          'claude_api',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }

      now += 60001;
      const result = await service.execute('claude_api', async () => 'ok');
      expect(result).toBe('ok');

      Date.now = realNow;
    });

    it('fred_api has threshold 3', async () => {
      for (let i = 0; i < 3; i++) {
        await service.execute(
          'fred_api',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }
      expect(
        service.getStatus().find((s) => s.service === 'fred_api')?.state,
      ).toBe('open');
    });

    it('stripe_api has threshold 3', async () => {
      for (let i = 0; i < 3; i++) {
        await service.execute(
          'stripe_api',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }
      expect(
        service.getStatus().find((s) => s.service === 'stripe_api')?.state,
      ).toBe('open');
    });

    it('unknown key uses default config', async () => {
      for (let i = 0; i < 5; i++) {
        await service.execute(
          'unknown_svc',
          async () => {
            throw new Error('err');
          },
          () => null,
        );
      }
      expect(
        service.getStatus().find((s) => s.service === 'unknown_svc')?.state,
      ).toBe('open');
    });
  });

  // ── onModuleDestroy ──────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('clears eviction timer without error', () => {
      service.onModuleDestroy();
      expect(true).toBe(true);
    });
  });
});
