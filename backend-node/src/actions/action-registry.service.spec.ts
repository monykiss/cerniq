/**
 * ActionRegistryService — dispatch + audit contract.
 *
 * Locks the rules from the type contract:
 *   1. register() throws on duplicate id.
 *   2. dispatch() of unknown id returns success:false, error:'NOT_FOUND'.
 *   3. dispatch() to a permission-gated action checks userRoles.
 *   4. Handler that throws → caught, returns success:false with error message.
 *   5. Handler that returns a raw payload → wrapped as success:true, data:payload.
 *   6. Handler that returns a fully-formed ActionResult → passed through.
 *   7. Audit log is written on every dispatch (unless meta.audit === false).
 *   8. Audit write failure does NOT break the dispatch.
 */
import { ActionRegistryService } from './action-registry.service';
import { ActionMeta } from './action.types';

describe('ActionRegistryService', () => {
  let prisma: { auditLog: { create: jest.Mock } };
  let service: ActionRegistryService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    service = new ActionRegistryService(prisma as any);
  });

  const meta = (over: Partial<ActionMeta> = {}): ActionMeta => ({
    id: 'test.action',
    label: { en: 'Test', es: 'Test' },
    module: 'test',
    ...over,
  });

  // ── register() ─────────────────────────────────────────────

  it('register() adds the action to the in-memory map', () => {
    service.register(meta(), async () => ({ ok: true }));
    expect(service.list()).toHaveLength(1);
    expect(service.get('test.action')).toBeDefined();
  });

  it('register() throws on duplicate id', () => {
    service.register(meta(), async () => ({}));
    expect(() => service.register(meta(), async () => ({}))).toThrow(
      /already registered/,
    );
  });

  // ── list() ─────────────────────────────────────────────────

  it('list() returns metadata only, never handlers', () => {
    service.register(meta({ id: 'a' }), async () => ({}));
    service.register(meta({ id: 'b', module: 'other' }), async () => ({}));
    const all = service.list();
    expect(all).toHaveLength(2);
    expect(all.every((m) => 'id' in m && 'label' in m)).toBe(true);
  });

  it('list() filters by module', () => {
    service.register(meta({ id: 'a', module: 'alm' }), async () => ({}));
    service.register(meta({ id: 'b', module: 'reports' }), async () => ({}));
    expect(service.list({ module: 'alm' })).toHaveLength(1);
    expect(service.list({ module: 'alm' })[0].id).toBe('a');
  });

  // ── dispatch() — unknown action ───────────────────────────

  it('dispatch of unknown action returns NOT_FOUND, no audit', async () => {
    const result = await service.dispatch('does.not.exist', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_FOUND');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // No audit entry — 404 is not a user attempt worth logging.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // ── dispatch() — permissions ──────────────────────────────

  it('dispatch denies + audits when caller lacks required roles', async () => {
    service.register(meta({ permissions: ['admin'] }), async () => ({
      leaked: 'data',
    }));
    const result = await service.dispatch(
      'test.action',
      {},
      { userId: 'u1', userRoles: ['member'] },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('FORBIDDEN');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'test.action',
          outcome: 'denied',
          userId: 'u1',
        }),
      }),
    );
  });

  it('dispatch allows when caller has at least one matching role', async () => {
    service.register(meta({ permissions: ['admin', 'analyst'] }), async () => ({
      value: 42,
    }));
    const result = await service.dispatch(
      'test.action',
      {},
      { userId: 'u1', userRoles: ['analyst'] },
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 42 });
  });

  // ── dispatch() — handler shapes ───────────────────────────

  it('wraps a raw payload as success:true with data + durationMs', async () => {
    service.register(meta(), async () => ({ foo: 'bar' }));
    const result = await service.dispatch('test.action', {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ foo: 'bar' });
    expect(typeof result.durationMs).toBe('number');
  });

  it('passes through a fully-formed ActionResult unchanged', async () => {
    service.register(meta(), async () => ({
      success: false,
      error: 'business error',
      durationMs: 0,
      criticalGapCount: 2,
    }));
    const result = await service.dispatch('test.action', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('business error');
    expect(result.criticalGapCount).toBe(2);
    // durationMs is refreshed if the handler set it to 0
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('catches handler throw and returns structured failure', async () => {
    service.register(meta(), async () => {
      throw new Error('database is down');
    });
    const result = await service.dispatch('test.action', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('database is down');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // Failure is audited.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'test.action',
          outcome: 'failure',
        }),
      }),
    );
  });

  // ── dispatch() — audit ─────────────────────────────────────

  it('writes a success audit entry on successful dispatch', async () => {
    service.register(meta(), async () => ({ ok: 1 }));
    await service.dispatch(
      'test.action',
      { institutionId: 'inst-1' },
      { userId: 'u1', ipAddress: '1.2.3.4', userAgent: 'curl/8' },
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.auditLog.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      action: 'test.action',
      resource: 'action_dispatch',
      resourceId: 'inst-1',
      outcome: 'success',
      userId: 'u1',
      institutionId: 'inst-1',
      ipAddress: '1.2.3.4',
      userAgent: 'curl/8',
    });
    expect(call.data.changes).toEqual({ input: { institutionId: 'inst-1' } });
    expect(call.data.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips audit when meta.audit === false', async () => {
    service.register(meta({ audit: false }), async () => ({ ok: 1 }));
    await service.dispatch('test.action', {});
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('audit write failure does NOT break the dispatch', async () => {
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));
    service.register(meta(), async () => ({ ok: 1 }));
    const result = await service.dispatch('test.action', {});
    // Dispatch result is still returned cleanly.
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: 1 });
  });

  it('records criticalGapCount and warningGapCount in audit metadata', async () => {
    service.register(meta(), async () => ({
      success: false,
      error: 'has gaps',
      durationMs: 5,
      criticalGapCount: 3,
      warningGapCount: 7,
    }));
    await service.dispatch('test.action', { institutionId: 'inst-1' });
    const call = prisma.auditLog.create.mock.calls[0][0];
    expect(call.data.metadata).toMatchObject({
      criticalGapCount: 3,
      warningGapCount: 7,
      error: 'has gaps',
    });
  });
});
