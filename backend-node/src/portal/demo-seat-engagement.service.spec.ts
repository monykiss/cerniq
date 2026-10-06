import { Logger } from '@nestjs/common';
import { DemoSeatEngagementService } from './demo-seat-engagement.service';

describe('DemoSeatEngagementService', () => {
  let service: DemoSeatEngagementService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      demoSeatEngagementEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    service = new DemoSeatEngagementService(prisma);
  });

  describe('recordEvent', () => {
    it('persists with the right shape', async () => {
      await service.recordEvent({
        prospectInstitutionId: 'p1',
        userId: 'u1',
        eventType: 'provisioned',
        metadata: { source: 'cossec', slug: 'caguas' },
      });

      expect(prisma.demoSeatEngagementEvent.create).toHaveBeenCalledWith({
        data: {
          prospectInstitutionId: 'p1',
          userId: 'u1',
          eventType: 'provisioned',
          metadata: { source: 'cossec', slug: 'caguas' },
        },
      });
    });

    it('accepts null userId for pre-user events', async () => {
      await service.recordEvent({
        prospectInstitutionId: 'p1',
        userId: null,
        eventType: 'provisioned',
      });

      expect(prisma.demoSeatEngagementEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: null, metadata: null }),
      });
    });

    it('NEVER throws when the DB write fails (fire-and-forget invariant)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      prisma.demoSeatEngagementEvent.create.mockRejectedValueOnce(
        new Error('DB timeout'),
      );

      await expect(
        service.recordEvent({
          prospectInstitutionId: 'p1',
          eventType: 'report_viewed',
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.engagement_record_failed',
          eventType: 'report_viewed',
          prospectInstitutionId: 'p1',
        }),
      );
      warnSpy.mockRestore();
    });

    it('treats non-Error rejections gracefully', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      prisma.demoSeatEngagementEvent.create.mockRejectedValueOnce(
        'string-not-error',
      );

      await expect(
        service.recordEvent({
          prospectInstitutionId: 'p1',
          eventType: 'portal_viewed',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('listEventsForProspect', () => {
    it('returns events ordered desc with ISO timestamps', async () => {
      prisma.demoSeatEngagementEvent.findMany.mockResolvedValue([
        {
          id: 'e1',
          prospectInstitutionId: 'p1',
          userId: 'u1',
          eventType: 'report_viewed',
          metadata: { language: 'es' },
          createdAt: new Date('2026-04-10T12:00:00Z'),
        },
        {
          id: 'e2',
          prospectInstitutionId: 'p1',
          userId: 'u1',
          eventType: 'portal_viewed',
          metadata: null,
          createdAt: new Date('2026-04-09T09:00:00Z'),
        },
      ]);

      const result = await service.listEventsForProspect('p1');

      expect(prisma.demoSeatEngagementEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { prospectInstitutionId: 'p1' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].createdAt).toBe('2026-04-10T12:00:00.000Z');
      expect(result[0].eventType).toBe('report_viewed');
      expect(result[0].metadata).toEqual({ language: 'es' });
    });

    it('honors the limit parameter', async () => {
      prisma.demoSeatEngagementEvent.findMany.mockResolvedValue([]);

      await service.listEventsForProspect('p1', 10);

      expect(prisma.demoSeatEngagementEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('getSummaryForSeats', () => {
    it('returns an empty map for an empty input array (no DB round-trip)', async () => {
      const result = await service.getSummaryForSeats([]);
      expect(result.size).toBe(0);
      expect(prisma.demoSeatEngagementEvent.groupBy).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('aggregates counts and latest event per prospect', async () => {
      prisma.demoSeatEngagementEvent.groupBy.mockResolvedValue([
        { prospectInstitutionId: 'p1', _count: { _all: 5 } },
        { prospectInstitutionId: 'p2', _count: { _all: 2 } },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        {
          prospect_institution_id: 'p1',
          event_type: 'report_viewed',
          created_at: new Date('2026-04-10T12:00:00Z'),
        },
        {
          prospect_institution_id: 'p2',
          event_type: 'portal_viewed',
          created_at: new Date('2026-04-09T08:00:00Z'),
        },
      ]);

      const result = await service.getSummaryForSeats(['p1', 'p2', 'p3']);

      expect(result.get('p1')).toEqual({
        eventCount: 5,
        lastEventType: 'report_viewed',
        lastEventAt: '2026-04-10T12:00:00.000Z',
      });
      expect(result.get('p2')).toEqual({
        eventCount: 2,
        lastEventType: 'portal_viewed',
        lastEventAt: '2026-04-09T08:00:00.000Z',
      });
      // p3 has no events — returned as zeros, not missing
      expect(result.get('p3')).toEqual({
        eventCount: 0,
        lastEventType: null,
        lastEventAt: null,
      });
    });

    it('uses a single parameterized SQL query for latest events', async () => {
      prisma.demoSeatEngagementEvent.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getSummaryForSeats(['p1', 'p2']);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sqlArg = prisma.$queryRaw.mock.calls[0][0];
      expect(sqlArg.strings.join('')).toContain('DISTINCT ON');
      expect(sqlArg.values).toEqual([['p1', 'p2']]);
    });

    it('runs both aggregates in parallel (Promise.all)', async () => {
      let groupByStarted = false;
      let queryRawStarted = false;
      let groupByResolved = false;

      prisma.demoSeatEngagementEvent.groupBy.mockImplementation(() => {
        groupByStarted = true;
        return new Promise((res) =>
          setTimeout(() => {
            groupByResolved = true;
            res([]);
          }, 5),
        );
      });
      prisma.$queryRaw.mockImplementation(() => {
        queryRawStarted = true;
        // Should be started BEFORE groupBy resolves
        expect(groupByResolved).toBe(false);
        return Promise.resolve([]);
      });

      await service.getSummaryForSeats(['p1']);

      expect(groupByStarted).toBe(true);
      expect(queryRawStarted).toBe(true);
    });
  });
});
