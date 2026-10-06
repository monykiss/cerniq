import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DemoSeatService } from './demo-seat.service';

describe('DemoSeatService', () => {
  let service: DemoSeatService;
  let prisma: any;
  let almEnterprise: any;
  let cossec: any;
  let ncua: any;
  let billing: any;
  let email: any;
  let audit: any;
  let engagement: any;

  const cossecPullResult = {
    slug: 'caguas',
    institutionName: 'Cooperativa Ejemplo Centro',
    city: 'Municipio A, PR',
    state: 'PR',
    totalAssets: 2800,
    netWorth: 280,
    netWorthRatio: 10,
    members: 142000,
    asOfQuarter: 'Q3-2025',
    asOfDate: '2025-09-30T00:00:00.000Z',
    source: 'cossec_public_filings',
    disclosure: 'PRELIMINARY — Built from COSSEC public filings, Q3-2025',
    items: [
      {
        category: 'asset',
        subcategory: 'cash',
        name: 'Cash',
        nameEs: 'Efectivo',
        balance: 100,
        rate: 0.045,
        duration: 0.1,
        rateType: 'variable',
      },
      {
        category: 'liability',
        subcategory: 'savings',
        name: 'Savings',
        nameEs: 'Ahorros',
        balance: 200,
        rate: 0.013,
        duration: 1,
        rateType: 'variable',
      },
    ],
    loanSegments: [],
  };

  beforeEach(() => {
    prisma = {
      prospectInstitution: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'cfo@coop-a.example',
          provider: 'demo_seat',
        }),
      },
      workspace: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ws-1' }),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ tier: 'demo' }),
      },
      institution: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      reportJob: {
        create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      },
    };

    almEnterprise = {
      createInstitution: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      importBalanceSheetItems: jest.fn().mockResolvedValue({ count: 2 }),
    };

    cossec = {
      pullBySlug: jest.fn().mockResolvedValue(cossecPullResult),
      resolveSlugForName: jest.fn().mockReturnValue('caguas'),
    };

    ncua = {
      pullByCharterNumber: jest.fn(),
    };

    billing = {
      generateMagicLink: jest
        .fn()
        .mockResolvedValue('https://cerniq.io/auth/magic?token=abc'),
    };

    email = {
      sendDemoPortalReady: jest.fn().mockResolvedValue(undefined),
    };

    audit = {
      log: jest.fn(),
    };

    engagement = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    };

    service = new DemoSeatService(
      prisma,
      almEnterprise,
      cossec,
      ncua,
      billing,
      email,
      audit,
      engagement,
    );
  });

  describe('provisionFromProspect', () => {
    const baseProspect = {
      id: 'prospect-1',
      name: 'Cooperativa Ejemplo Centro',
      institutionType: 'cooperativa',
      publicDataSource: 'cossec',
      publicDataIdentifier: 'caguas',
      contactEmail: 'cfo@coop-a.example',
      contactName: 'CFO Caguas',
      outreachStatus: 'not_started',
      demoUserId: null,
    };

    it('throws NotFoundException when the prospect does not exist', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(null);
      await expect(
        service.provisionFromProspect({ prospectId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no contact email is available', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue({
        ...baseProspect,
        contactEmail: null,
      });
      await expect(
        service.provisionFromProspect({ prospectId: 'prospect-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('provisions a fresh demo seat end to end for a COSSEC cooperativa', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.provisionFromProspect({
        prospectId: 'prospect-1',
      });

      // 1. Public-data fetch
      expect(cossec.pullBySlug).toHaveBeenCalledWith('caguas');

      // 2. User created
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'cfo@coop-a.example',
            provider: 'demo_seat',
            emailVerified: true,
          }),
        }),
      );

      // 3. Workspace + institution + balance sheet
      expect(prisma.workspace.create).toHaveBeenCalled();
      expect(almEnterprise.createInstitution).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          name: 'Cooperativa Ejemplo Centro',
          type: 'cooperativa',
          primaryRegulator: 'COSSEC',
        }),
      );
      expect(almEnterprise.importBalanceSheetItems).toHaveBeenCalledWith(
        'inst-1',
        expect.arrayContaining([
          expect.objectContaining({ category: 'asset', subcategory: 'cash' }),
        ]),
      );

      // 4. Subscription set to demo with 14-day TTL
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({
            tier: 'demo',
            status: 'active',
          }),
        }),
      );

      // 5. Report job queued
      expect(prisma.reportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            institutionId: 'inst-1',
            status: 'QUEUED',
            triggeredBy: 'demo_provision',
          }),
        }),
      );

      // 6. Magic link generated and persisted
      expect(billing.generateMagicLink).toHaveBeenCalledWith(
        'user-1',
        expect.any(Number),
      );
      expect(prisma.prospectInstitution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prospect-1' },
          data: expect.objectContaining({
            demoUserId: 'user-1',
            demoMagicLinkUrl: 'https://cerniq.io/auth/magic?token=abc',
            outreachStatus: 'portal_provisioned',
          }),
        }),
      );

      // 7. Audit logged
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'demo_seat_provisioned',
          resource: 'prospect_institution',
        }),
      );

      // 8. No email sent unless explicitly requested
      expect(email.sendDemoPortalReady).not.toHaveBeenCalled();

      // 9. Result shape
      expect(result.userId).toBe('user-1');
      expect(result.reportJobId).toBe('job-1');
      expect(result.magicLinkUrl).toBe(
        'https://cerniq.io/auth/magic?token=abc',
      );
      expect(result.source).toBe('cossec_public_filings');
      expect(result.reused).toBe(false);
    });

    it('marks the seat as reused when re-provisioning an existing demo prospect', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue({
        ...baseProspect,
        demoUserId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'cfo@coop-a.example',
        provider: 'demo_seat',
        passwordHash: null,
      });

      const result = await service.provisionFromProspect({
        prospectId: 'prospect-1',
      });

      expect(result.reused).toBe(true);
      // Existing user is reused, no new user created
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('sends the demo-portal-ready email when sendEmail=true', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue(null);

      await service.provisionFromProspect({
        prospectId: 'prospect-1',
        sendEmail: true,
      });

      expect(email.sendDemoPortalReady).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'cfo@coop-a.example',
          institutionName: 'Cooperativa Ejemplo Centro',
          magicLinkUrl: 'https://cerniq.io/auth/magic?token=abc',
          language: 'es',
        }),
      );
    });

    it('honors override contactEmail and ttlDays', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue({
        ...baseProspect,
        contactEmail: null,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await service.provisionFromProspect({
        prospectId: 'prospect-1',
        contactEmail: 'override@example.com',
        ttlDays: 30,
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'override@example.com' }),
        }),
      );

      // Subscription expires 30 days out
      const subscriptionCall = prisma.subscription.upsert.mock.calls[0][0];
      const expiresAt = subscriptionCall.create.currentPeriodEnd as Date;
      const daysOut = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
      expect(daysOut).toBeGreaterThanOrEqual(29);
      expect(daysOut).toBeLessThanOrEqual(30);
    });

    it('rejects ttlDays values that fall outside 1-60', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue(null);

      // 0 → clamped to 1
      await service.provisionFromProspect({
        prospectId: 'prospect-1',
        ttlDays: 0,
      });
      const firstCall = prisma.subscription.upsert.mock.calls[0][0];
      const firstExpiresAt = firstCall.create.currentPeriodEnd as Date;
      const firstDaysOut = Math.round(
        (firstExpiresAt.getTime() - Date.now()) / 86400000,
      );
      expect(firstDaysOut).toBe(1);

      // 999 → clamped to 60
      jest.clearAllMocks();
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        provider: 'demo_seat',
      });
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue({ id: 'ws-1' });
      prisma.subscription.upsert.mockResolvedValue({ tier: 'demo' });
      prisma.institution.findFirst.mockResolvedValue(null);
      prisma.reportJob.create.mockResolvedValue({ id: 'job-1' });

      await service.provisionFromProspect({
        prospectId: 'prospect-1',
        ttlDays: 999,
      });
      const secondCall = prisma.subscription.upsert.mock.calls[0][0];
      const secondExpiresAt = secondCall.create.currentPeriodEnd as Date;
      const secondDaysOut = Math.round(
        (secondExpiresAt.getTime() - Date.now()) / 86400000,
      );
      expect(secondDaysOut).toBe(60);
    });

    it('falls back to NCUA puller for non-cooperativa prospects with a charter number', async () => {
      const ncuaProspect = {
        id: 'prospect-2',
        name: 'Test Federal CU',
        institutionType: 'credit_union',
        publicDataSource: 'ncua',
        publicDataIdentifier: '12345',
        contactEmail: 'cfo@testfcu.example',
        contactName: null,
        outreachStatus: 'not_started',
        demoUserId: null,
      };
      prisma.prospectInstitution.findUnique.mockResolvedValue(ncuaProspect);
      prisma.user.findUnique.mockResolvedValue(null);
      ncua.pullByCharterNumber.mockResolvedValue({
        institutionName: 'Test Federal CU',
        totalAssets: 200,
        asOfDate: '2025-09-30',
        items: [
          {
            category: 'asset',
            subcategory: 'cash',
            name: 'Cash',
            balance: 50,
            rate: 0.04,
            duration: 0.1,
            rateType: 'variable',
          },
        ],
      });

      const result = await service.provisionFromProspect({
        prospectId: 'prospect-2',
      });

      expect(ncua.pullByCharterNumber).toHaveBeenCalledWith('12345');
      expect(result.source).toBe('ncua_5300');
    });
  });

  describe('platform admin / paid user safeguards', () => {
    const baseProspect = {
      id: 'prospect-master',
      name: 'Cooperativa Ejemplo Centro',
      institutionType: 'cooperativa',
      publicDataSource: 'cossec',
      publicDataIdentifier: 'caguas',
      contactEmail: 'owner@example.com',
      contactName: 'Platform admin',
      outreachStatus: 'not_started',
      demoUserId: null,
    };

    it('NEVER overwrites a platform admin / paid user subscription with tier=demo', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue({
        id: 'master-user-id',
        email: 'owner@example.com',
        provider: 'email',
        passwordHash: 'real-hash',
      });
      prisma.user.create.mockResolvedValue({ id: 'master-user-id' });
      // CRITICAL: pre-existing paid subscription
      prisma.subscription.findUnique.mockResolvedValue({
        userId: 'master-user-id',
        tier: 'monthly',
        status: 'active',
      });

      const result = await service.provisionFromProspect({
        prospectId: 'prospect-master',
      });

      // Subscription upsert MUST NOT have been called (the safeguard kicked in)
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();

      // Result surfaces the safeguard
      expect(result.subscriptionUpdated).toBe(false);

      // The user was reused (no new user created) and the report job was still scheduled
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.reportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'master-user-id',
            triggeredBy: 'demo_provision',
          }),
        }),
      );
    });

    it('does overwrite a free-tier subscription with tier=demo', async () => {
      prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.subscription.findUnique.mockResolvedValue({
        userId: 'user-1',
        tier: 'free',
        status: 'active',
      });

      const result = await service.provisionFromProspect({
        prospectId: 'prospect-master',
      });

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tier: 'demo' }),
        }),
      );
      expect(result.subscriptionUpdated).toBe(true);
    });

    it('protects all paid tiers (one_time, monthly, annual, partner)', async () => {
      const paidTiers = ['one_time', 'monthly', 'annual', 'partner'];
      for (const tier of paidTiers) {
        prisma.prospectInstitution.findUnique.mockResolvedValue(baseProspect);
        prisma.user.findUnique.mockResolvedValue({
          id: `user-${tier}`,
          email: 'paid@example.com',
          provider: 'email',
          passwordHash: 'hash',
        });
        prisma.user.create.mockResolvedValue({ id: `user-${tier}` });
        prisma.subscription.findUnique.mockResolvedValue({
          userId: `user-${tier}`,
          tier,
          status: 'active',
        });
        prisma.subscription.upsert.mockClear();

        const result = await service.provisionFromProspect({
          prospectId: 'prospect-master',
        });

        expect(prisma.subscription.upsert).not.toHaveBeenCalled();
        expect(result.subscriptionUpdated).toBe(false);
      }
    });
  });

  describe('markViewed', () => {
    it('updates the demoLastViewedAt for the user', async () => {
      prisma.prospectInstitution.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await service.markViewed('user-1');

      expect(prisma.prospectInstitution.updateMany).toHaveBeenCalledWith({
        where: { demoUserId: 'user-1' },
        data: { demoLastViewedAt: expect.any(Date) },
      });
    });
  });

  describe('sweepExpired', () => {
    beforeEach(() => {
      prisma.prospectInstitution.findMany = jest.fn();
      prisma.subscription.update = jest.fn().mockResolvedValue({});
    });

    it('returns zero when nothing has expired', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([]);

      const result = await service.sweepExpired();

      expect(result).toEqual({ scanned: 0, expired: 0, expiredIds: [] });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('cancels demo subscriptions whose TTL has passed', async () => {
      const expiredAt = new Date('2026-04-01T00:00:00Z');
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coop A',
          demoUserId: 'u1',
          demoExpiresAt: expiredAt,
        },
        {
          id: 'p2',
          name: 'Coop B',
          demoUserId: 'u2',
          demoExpiresAt: expiredAt,
        },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ userId: 'u1', tier: 'demo', status: 'active' })
        .mockResolvedValueOnce({
          userId: 'u2',
          tier: 'demo',
          status: 'active',
        });

      const result = await service.sweepExpired(
        new Date('2026-04-10T00:00:00Z'),
      );

      expect(result.scanned).toBe(2);
      expect(result.expired).toBe(2);
      expect(result.expiredIds).toEqual(['p1', 'p2']);
      expect(prisma.subscription.update).toHaveBeenCalledTimes(2);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'demo_seat_expired' }),
      );
    });

    it('NEVER cancels a paid subscription — protected tiers are skipped', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p3',
          name: 'Protected Coop',
          demoUserId: 'u3',
          demoExpiresAt: new Date('2026-04-01T00:00:00Z'),
        },
      ]);
      // CRITICAL: the user has a paid 'annual' subscription (e.g. the platform admin
      // reused a real email as a prospect contact). Sweeper must leave it alone.
      prisma.subscription.findUnique.mockResolvedValue({
        userId: 'u3',
        tier: 'annual',
        status: 'active',
      });

      const result = await service.sweepExpired();

      expect(result.scanned).toBe(1);
      expect(result.expired).toBe(0);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('is idempotent — skips subscriptions already marked cancelled', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p4',
          name: 'Coop C',
          demoUserId: 'u4',
          demoExpiresAt: new Date('2026-04-01T00:00:00Z'),
        },
      ]);
      prisma.subscription.findUnique.mockResolvedValue({
        userId: 'u4',
        tier: 'demo',
        status: 'cancelled', // already cancelled
      });

      const result = await service.sweepExpired();

      expect(result.expired).toBe(0);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('sendExpiryReminders', () => {
    beforeEach(() => {
      prisma.prospectInstitution.findMany = jest.fn();
      prisma.emailSequence = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      };
      prisma.subscription.findUnique = jest.fn().mockResolvedValue({
        tier: 'demo',
        status: 'active',
      });
      email.sendDemoExpiryReminder = jest.fn().mockResolvedValue(undefined);
    });

    it('sends a reminder per seat in the 48–96h window', async () => {
      const now = new Date('2026-04-15T14:00:00Z');
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Cooperativa Ejemplo Centro',
          demoUserId: 'u1',
          contactEmail: 'cfo@coop-a.example',
          contactName: 'CFO Caguas',
          demoExpiresAt: new Date('2026-04-18T14:00:00Z'), // 72h out
        },
      ]);

      const result = await service.sendExpiryReminders(now);

      expect(result.sent).toBe(1);
      expect(result.skipped).toBe(0);
      expect(email.sendDemoExpiryReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'cfo@coop-a.example',
          institutionName: 'Cooperativa Ejemplo Centro',
          daysRemaining: 3,
          language: 'es',
        }),
      );
      // Dedup sentinel recorded in EmailSequence
      expect(prisma.emailSequence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            sequenceKey: 'demo_expiry_reminder',
          }),
        }),
      );
    });

    it('skips seats that already received a reminder (dedup)', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coop',
          demoUserId: 'u1',
          contactEmail: 'cfo@example.coop',
          contactName: 'CFO',
          demoExpiresAt: new Date(Date.now() + 72 * 3600_000),
        },
      ]);
      // Pre-existing reminder record
      prisma.emailSequence.findFirst.mockResolvedValue({
        id: 'seq-1',
        sequenceKey: 'demo_expiry_reminder',
      });

      const result = await service.sendExpiryReminders();

      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
      expect(email.sendDemoExpiryReminder).not.toHaveBeenCalled();
      expect(prisma.emailSequence.create).not.toHaveBeenCalled();
    });

    it('skips seats whose user converted between scan and send', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coop',
          demoUserId: 'u1',
          contactEmail: 'cfo@example.coop',
          contactName: 'CFO',
          demoExpiresAt: new Date(Date.now() + 72 * 3600_000),
        },
      ]);
      // Between scan and send the user upgraded to monthly
      prisma.subscription.findUnique.mockResolvedValue({
        tier: 'monthly',
        status: 'active',
      });

      const result = await service.sendExpiryReminders();

      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
      expect(email.sendDemoExpiryReminder).not.toHaveBeenCalled();
    });

    it('skips seats with no contactEmail', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coop',
          demoUserId: 'u1',
          contactEmail: null,
          contactName: null,
          demoExpiresAt: new Date(Date.now() + 72 * 3600_000),
        },
      ]);

      const result = await service.sendExpiryReminders();

      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
      expect(email.sendDemoExpiryReminder).not.toHaveBeenCalled();
    });

    it('returns zeros when the window is empty', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([]);

      const result = await service.sendExpiryReminders();

      expect(result).toEqual({ scanned: 0, sent: 0, skipped: 0 });
      expect(email.sendDemoExpiryReminder).not.toHaveBeenCalled();
    });

    it('continues past per-seat failures — one broken email does not break the batch', async () => {
      const now = new Date('2026-04-15T14:00:00Z');
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Coop A',
          demoUserId: 'u1',
          contactEmail: 'a@example.coop',
          contactName: 'A',
          demoExpiresAt: new Date('2026-04-18T14:00:00Z'),
        },
        {
          id: 'p2',
          name: 'Coop B',
          demoUserId: 'u2',
          contactEmail: 'b@example.coop',
          contactName: 'B',
          demoExpiresAt: new Date('2026-04-18T14:00:00Z'),
        },
      ]);
      // First send throws (Resend down), second succeeds
      email.sendDemoExpiryReminder
        .mockRejectedValueOnce(new Error('Resend error'))
        .mockResolvedValueOnce(undefined);

      const result = await service.sendExpiryReminders(now);

      expect(result.scanned).toBe(2);
      expect(result.sent).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('listAdminDemoSeats', () => {
    beforeEach(() => {
      prisma.prospectInstitution.findMany = jest.fn();
    });

    it('annotates seats with daysRemaining and status', async () => {
      const now = new Date('2026-04-10T00:00:00Z');
      const futureExpiry = new Date('2026-04-20T00:00:00Z');
      const pastExpiry = new Date('2026-04-01T00:00:00Z');

      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          id: 'p-active',
          name: 'Active Coop',
          contactEmail: 'cfo@active.coop',
          contactName: 'Active CFO',
          institutionType: 'cooperativa',
          location: 'San Juan, PR',
          publicDataSource: 'cossec',
          demoUserId: 'u-active',
          demoReportJobId: 'job-active',
          demoProvisionedAt: new Date('2026-04-06T00:00:00Z'),
          demoExpiresAt: futureExpiry,
          demoLastViewedAt: new Date('2026-04-07T00:00:00Z'),
          demoMagicLinkUrl: 'https://cerniq.io/auth/magic?token=active',
          outreachStatus: 'portal_provisioned',
        },
        {
          id: 'p-expired',
          name: 'Expired Coop',
          contactEmail: 'cfo@expired.coop',
          contactName: null,
          institutionType: 'cooperativa',
          location: 'Ponce, PR',
          publicDataSource: 'cossec',
          demoUserId: 'u-expired',
          demoReportJobId: 'job-expired',
          demoProvisionedAt: new Date('2026-03-15T00:00:00Z'),
          demoExpiresAt: pastExpiry,
          demoLastViewedAt: null,
          demoMagicLinkUrl: 'https://cerniq.io/auth/magic?token=expired',
          outreachStatus: 'portal_provisioned',
        },
      ]);

      const seats = await service.listAdminDemoSeats('all', now);

      expect(seats).toHaveLength(2);
      expect(seats[0]).toMatchObject({
        prospectId: 'p-active',
        status: 'active',
        daysRemaining: 10,
        hasBeenViewed: true,
      });
      expect(seats[1]).toMatchObject({
        prospectId: 'p-expired',
        status: 'expired',
        daysRemaining: 0,
        hasBeenViewed: false,
      });
    });

    it('filters to active seats only', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([]);

      await service.listAdminDemoSeats(
        'active',
        new Date('2026-04-10T00:00:00Z'),
      );

      expect(prisma.prospectInstitution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            demoExpiresAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });

    it('filters to expired seats only', async () => {
      prisma.prospectInstitution.findMany.mockResolvedValue([]);

      await service.listAdminDemoSeats(
        'expired',
        new Date('2026-04-10T00:00:00Z'),
      );

      expect(prisma.prospectInstitution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            demoExpiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('getDemoSeatForUser', () => {
    it('returns the prospect record for the demo user', async () => {
      prisma.prospectInstitution.findFirst = jest.fn().mockResolvedValue({
        id: 'prospect-1',
        name: 'Cooperativa Ejemplo Centro',
      });

      const result = await service.getDemoSeatForUser('user-1');

      expect(result?.name).toBe('Cooperativa Ejemplo Centro');
      expect(prisma.prospectInstitution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { demoUserId: 'user-1' } }),
      );
    });
  });
});
