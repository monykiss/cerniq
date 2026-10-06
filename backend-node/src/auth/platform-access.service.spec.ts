import { PlatformAccessService } from './platform-access.service';

describe('PlatformAccessService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('blocks OWNER accounts when recovery bypass is unset (opt-in only)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLATFORM_RECOVERY_OWNER_BYPASS;

    const service = new PlatformAccessService({} as any);
    const access = service.evaluateAccess({
      subscription: { tier: 'free', status: null },
      role: 'OWNER',
    });

    expect(access).toMatchObject({
      platformAccessAllowed: false,
      reason: 'subscription_required',
      isPaid: false,
    });
  });

  it('allows OWNER accounts only when PLATFORM_RECOVERY_OWNER_BYPASS is explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_RECOVERY_OWNER_BYPASS = 'true';

    const service = new PlatformAccessService({} as any);
    const access = service.evaluateAccess({
      subscription: { tier: 'free', status: null },
      role: 'OWNER',
    });

    expect(access).toMatchObject({
      platformAccessAllowed: true,
      reason: 'owner_recovery_bypass',
      isPaid: false,
    });
  });

  it('keeps non-OWNER users blocked when they do not have paid access', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_RECOVERY_OWNER_BYPASS = 'true';

    const service = new PlatformAccessService({} as any);
    const access = service.evaluateAccess({
      subscription: { tier: 'free', status: null },
      role: 'VIEWER',
    });

    expect(access).toMatchObject({
      platformAccessAllowed: false,
      reason: 'subscription_required',
    });
  });

  it('grants platform-admin access only when the persisted flag is true', () => {
    const service = new PlatformAccessService({} as any);
    const access = service.evaluateAccess({
      subscription: { tier: 'free', status: null },
      role: 'VIEWER',
      platformAdmin: true,
    });

    expect(access).toMatchObject({
      platformAccessAllowed: true,
      isPlatformAdmin: true,
      reason: 'platform_admin',
    });
  });

  it('fails closed when the platform-admin flag is missing or not strictly true', () => {
    const service = new PlatformAccessService({} as any);

    for (const platformAdmin of [undefined, false, 'true', 1, null]) {
      const access = service.evaluateAccess({
        subscription: { tier: 'free', status: null },
        role: 'VIEWER',
        platformAdmin: platformAdmin as unknown as boolean,
      });
      expect(access.isPlatformAdmin).toBe(false);
      expect(access.platformAccessAllowed).toBe(false);
    }
  });

  it('grants access to paid subscriptions without platform-admin privilege', () => {
    const service = new PlatformAccessService({} as any);
    const access = service.evaluateAccess({
      subscription: { tier: 'monthly', status: 'active' },
      role: 'VIEWER',
    });

    expect(access).toMatchObject({
      platformAccessAllowed: true,
      isPlatformAdmin: false,
      isPaid: true,
      reason: 'paid',
    });
  });

  describe('getAccessForUser', () => {
    it('reads the platform-admin flag from the user row', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            role: 'OWNER',
            platformAdmin: true,
            subscription: null,
          }),
        },
      };
      const service = new PlatformAccessService(prisma as any);

      const access = await service.getAccessForUser('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          select: expect.objectContaining({ platformAdmin: true }),
        }),
      );
      expect(access.isPlatformAdmin).toBe(true);
      expect(access.reason).toBe('platform_admin');
    });

    it('denies access when the user row does not exist', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const service = new PlatformAccessService(prisma as any);

      const access = await service.getAccessForUser('missing-user');

      expect(access.isPlatformAdmin).toBe(false);
      expect(access.platformAccessAllowed).toBe(false);
    });

    it('prefers an explicitly supplied role over the stored role', async () => {
      process.env.PLATFORM_RECOVERY_OWNER_BYPASS = 'true';
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            role: 'VIEWER',
            platformAdmin: false,
            subscription: null,
          }),
        },
      };
      const service = new PlatformAccessService(prisma as any);

      const access = await service.getAccessForUser('user-1', null, 'OWNER');

      expect(access.reason).toBe('owner_recovery_bypass');
    });
  });
});
