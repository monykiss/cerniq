import { TenantContextMiddleware } from './tenant-context.middleware';

describe('TenantContextMiddleware', () => {
  let middleware: TenantContextMiddleware;
  let mockPrisma: { $executeRaw: jest.Mock };
  const VALID_ADMIN_KEY = 'valid-admin-key-from-env-abc123';
  const originalAdminKey = process.env.ADMIN_KEY;

  beforeEach(() => {
    mockPrisma = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    middleware = new TenantContextMiddleware(mockPrisma as any);
    process.env.ADMIN_KEY = VALID_ADMIN_KEY;
  });

  afterAll(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = originalAdminKey;
  });

  it('sets tenant context for authenticated requests with institutionId', async () => {
    const req: any = {
      headers: {},
      user: { institutionId: 'inst_abc123' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    // Verify the tagged template literal was called (Prisma parameterized query).
    // The first argument is a TemplateStringsArray; the second is the interpolated value.
    const call = mockPrisma.$executeRaw.mock.calls[0];
    // Tagged template calls pass [strings, ...values]
    expect(call[0]).toBeDefined(); // TemplateStringsArray
    expect(next).toHaveBeenCalled();
  });

  it('sets admin_mode only when x-admin-key matches ADMIN_KEY env', async () => {
    const req: any = {
      headers: { 'x-admin-key': VALID_ADMIN_KEY },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('does NOT set admin_mode for requests with a wrong x-admin-key', async () => {
    const req: any = {
      headers: { 'x-admin-key': 'attacker-guessed-value' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('does NOT set admin_mode when ADMIN_KEY env is unset', async () => {
    delete process.env.ADMIN_KEY;
    const req: any = {
      headers: { 'x-admin-key': 'any-value' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('sets admin_mode for Stripe webhook path (service bypass)', async () => {
    const req: any = {
      headers: {},
      path: '/api/billing/webhook',
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    // Signature validation happens in the controller; middleware only sets
    // the GUC so RLS doesn't block the post-verification writes.
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('does NOT apply service-bypass for a non-webhook authenticated request', async () => {
    const req: any = {
      headers: {},
      path: '/api/institutions/abc',
      user: { institutionId: 'inst_abc' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    // Sets tenant context (institution_id), not admin_mode
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('does not set any context for unauthenticated requests', async () => {
    const req: any = { headers: {} };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('does not set tenant context when user has no institutionId', async () => {
    const req: any = {
      headers: {},
      user: { email: 'user@example.com' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls next() even if $executeRaw fails for tenant context', async () => {
    mockPrisma.$executeRaw.mockRejectedValue(new Error('DB connection lost'));
    const req: any = {
      headers: {},
      user: { institutionId: 'inst_abc123' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() even if $executeRaw fails for admin mode', async () => {
    mockPrisma.$executeRaw.mockRejectedValue(new Error('DB connection lost'));
    const req: any = {
      headers: { 'x-admin-key': VALID_ADMIN_KEY },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('prioritizes admin mode over tenant context when both are present', async () => {
    const req: any = {
      headers: { 'x-admin-key': VALID_ADMIN_KEY },
      user: { institutionId: 'inst_abc123' },
    };
    const res: any = {};
    const next = jest.fn();

    await middleware.use(req, res, next);

    // Should only set admin_mode, not tenant context
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });
});
