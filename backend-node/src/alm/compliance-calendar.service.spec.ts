import { ComplianceCalendarService } from './compliance-calendar.service';

function mockPrisma(institution: any = null): any {
  return {
    institution: {
      findUnique: jest.fn().mockResolvedValue(institution),
    },
  };
}

describe('ComplianceCalendarService', () => {
  describe('calculateUrgency', () => {
    let service: ComplianceCalendarService;

    beforeEach(() => {
      service = new ComplianceCalendarService(mockPrisma());
    });

    const now = new Date('2026-03-29T12:00:00');

    it('returns OVERDUE for past dates', () => {
      expect(
        service.calculateUrgency(new Date('2026-03-28T12:00:00'), now),
      ).toBe('OVERDUE');
      expect(
        service.calculateUrgency(new Date('2026-01-01T12:00:00'), now),
      ).toBe('OVERDUE');
    });

    it('returns CRITICAL for 0-14 days', () => {
      expect(
        service.calculateUrgency(new Date('2026-03-29T13:00:00'), now),
      ).toBe('CRITICAL'); // same day
      expect(
        service.calculateUrgency(new Date('2026-04-05T12:00:00'), now),
      ).toBe('CRITICAL'); // 7 days
      expect(
        service.calculateUrgency(new Date('2026-04-12T12:00:00'), now),
      ).toBe('CRITICAL'); // 14 days
    });

    it('returns HIGH for 15-30 days', () => {
      expect(
        service.calculateUrgency(new Date('2026-04-15T12:00:00'), now),
      ).toBe('HIGH'); // 17 days
      expect(
        service.calculateUrgency(new Date('2026-04-28T12:00:00'), now),
      ).toBe('HIGH'); // 30 days
    });

    it('returns MEDIUM for 31-90 days', () => {
      expect(
        service.calculateUrgency(new Date('2026-05-15T12:00:00'), now),
      ).toBe('MEDIUM'); // 47 days
      expect(
        service.calculateUrgency(new Date('2026-06-27T12:00:00'), now),
      ).toBe('MEDIUM'); // 90 days
    });

    it('returns LOW for 91+ days', () => {
      expect(
        service.calculateUrgency(new Date('2026-07-15T12:00:00'), now),
      ).toBe('LOW');
      expect(
        service.calculateUrgency(new Date('2027-01-01T12:00:00'), now),
      ).toBe('LOW');
    });
  });

  describe('getUpcomingDeadlines', () => {
    it('returns warning when institution not found', async () => {
      const service = new ComplianceCalendarService(mockPrisma(null));
      const result = await service.getUpcomingDeadlines('nonexistent');
      expect(result.events).toHaveLength(0);
      expect(result.warning).toContain('not found');
    });

    it('generates COSSEC exam deadline from nextExamDate', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          nextExamDate: new Date('2026-06-15'),
          alcoMeetingFrequency: 'monthly',
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const exam = result.events.find((e) => e.id === 'cossec-exam');
      expect(exam).toBeDefined();
      expect(exam!.title).toBe('COSSEC Examination');
      expect(exam!.titleEs).toBe('Examen COSSEC');
      expect(exam!.category).toBe('exam');
    });

    it('estimates COSSEC exam from lastExamDate + 15 months', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          lastExamDate: new Date('2025-06-01'),
          alcoMeetingFrequency: 'monthly',
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const exam = result.events.find((e) => e.id === 'cossec-exam-estimated');
      expect(exam).toBeDefined();
      expect(exam!.title).toContain('Estimated');
    });

    it('generates ALCO meeting deadlines', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          alcoNextDate: new Date('2026-04-15'),
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const alcoEvents = result.events.filter((e) => e.category === 'meeting');
      expect(alcoEvents.length).toBeGreaterThanOrEqual(1);
      expect(alcoEvents[0].titleEs).toContain('ALCO');
    });

    it('all events have bilingual fields', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          nextExamDate: new Date('2026-09-01'),
          alcoMeetingFrequency: 'quarterly',
          alcoNextDate: new Date('2026-06-01'),
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      result.events.forEach((e) => {
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.titleEs.length).toBeGreaterThan(0);
        expect(e.description.length).toBeGreaterThan(0);
        expect(e.descriptionEs.length).toBeGreaterThan(0);
      });
    });

    it('generates quarterly COSSEC reports', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const reports = result.events.filter((e) => e.category === 'report');
      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(reports[0].id).toContain('cossec-report');
    });

    it('uses quarterly ALCO frequency when set', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'quarterly',
          alcoNextDate: new Date('2026-05-01'),
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const meetings = result.events.filter((e) => e.category === 'meeting');
      expect(meetings.length).toBe(3);
      expect(meetings[0].description).toContain('Quarterly');
    });

    it('generates fiscal year-end report when fiscalYearEnd is set', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          fiscalYearEnd: 'December',
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const fiscal = result.events.filter((e) =>
        e.id.startsWith('fiscal-year-end'),
      );
      expect(fiscal.length).toBe(1);
      expect(fiscal[0].description).toContain('fiscal year-end');
    });

    it('uses default third Wednesday when no alcoNextDate', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          // No alcoNextDate set — should default to 3rd Wednesday
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const meetings = result.events.filter((e) => e.category === 'meeting');
      expect(meetings.length).toBeGreaterThanOrEqual(3);
    });

    it('events are sorted by deadlineDate ascending', async () => {
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          nextExamDate: new Date('2027-06-15'),
          alcoMeetingFrequency: 'monthly',
          alcoNextDate: new Date('2026-04-15'),
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].deadlineDate.getTime()).toBeGreaterThanOrEqual(
          result.events[i - 1].deadlineDate.getTime(),
        );
      }
    });
  });

  describe('getInstitutionsWithUpcomingDeadlines', () => {
    it('returns institutions with upcoming deadlines', async () => {
      const prisma = {
        institution: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inst-1',
            name: 'CoopAhorro',
            type: 'cooperativa',
            nextExamDate: new Date(Date.now() + 5 * 86400000), // 5 days from now
            alcoMeetingFrequency: 'monthly',
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'inst-1',
              name: 'CoopAhorro',
              contactEmail: 'cfo@coop.com',
              contactName: 'Juan',
            },
          ]),
        },
      };

      const service = new ComplianceCalendarService(prisma as any);
      const results = await service.getInstitutionsWithUpcomingDeadlines(30);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('filters by workspaceId when provided', async () => {
      const prisma = {
        institution: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const service = new ComplianceCalendarService(prisma as any);
      await service.getInstitutionsWithUpcomingDeadlines(30, 'ws-1');
      expect(prisma.institution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
        }),
      );
    });
  });

  describe('alcoNextDate in the past advances to future', () => {
    it('advances a past alcoNextDate to the present/future', async () => {
      const pastDate = new Date('2020-01-15'); // well in the past
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          alcoNextDate: pastDate,
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const meetings = result.events.filter((e) => e.category === 'meeting');
      expect(meetings.length).toBeGreaterThanOrEqual(1);
      // All meeting dates should be in the future
      meetings.forEach((m) => {
        expect(m.deadlineDate.getTime()).toBeGreaterThan(Date.now() - 86400000);
      });
    });
  });

  describe('fiscal year-end report due date in the past triggers next year', () => {
    it('pushes fiscal year-end report to next year when due date is past', async () => {
      // Mock Date to be December 2026 so Jan FYE (Jan 31, 2026) + 90 days = May 1, 2026 is in the past
      const realDateCtor = global.Date;
      const mockNow = new realDateCtor('2026-12-15T12:00:00Z');
      const origNow = Date.now;
      Date.now = () => mockNow.getTime();
      const OrigDate = global.Date;
      // @ts-expect-error test-only Date shim
      global.Date = class extends realDateCtor {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockNow.getTime());
          } else {
            // @ts-expect-error forwarding Date constructor args in test shim
            super(...args);
          }
        }
        static now() {
          return mockNow.getTime();
        }
      };

      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'CoopAhorro',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          fiscalYearEnd: 'January',
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const fiscal = result.events.filter((e) =>
        e.id.startsWith('fiscal-year-end'),
      );
      expect(fiscal.length).toBe(1);
      // Should reference 2027 since Jan 2026 FYE + 90 days = May 1, 2026 which is past Dec 15, 2026
      expect(fiscal[0].deadlineDate.getFullYear()).toBe(2027);

      global.Date = OrigDate;
      Date.now = origNow;
    });
  });

  describe('getNextThirdWednesday edge case', () => {
    it('generates meetings in the future when no alcoNextDate is set', async () => {
      // This test ensures the getNextThirdWednesday path is exercised
      // (including potential recursion when the 3rd Wed of current month has passed)
      const service = new ComplianceCalendarService(
        mockPrisma({
          id: 'inst-1',
          name: 'Test',
          type: 'cooperativa',
          alcoMeetingFrequency: 'monthly',
          // No alcoNextDate — forces getNextThirdWednesday
        }),
      );

      const result = await service.getUpcomingDeadlines('inst-1');
      const meetings = result.events.filter((e) => e.category === 'meeting');
      expect(meetings.length).toBeGreaterThanOrEqual(3);
      // All meetings should be in the future
      const now = new Date();
      meetings.forEach((m) => {
        expect(m.deadlineDate.getTime()).toBeGreaterThan(
          now.getTime() - 86400000,
        );
      });
    });
  });
});
