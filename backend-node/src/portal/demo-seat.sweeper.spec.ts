import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DemoSeatSweeper } from './demo-seat.sweeper';
import { DemoSeatService } from './demo-seat.service';

// Mock @sentry/nestjs at the module level. The runtime module's exports
// are frozen (non-configurable), so jest.spyOn throws. This mock gives us
// the full control we need without touching the real module bindings.
jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((cb: (scope: any) => void) => {
    cb({
      setTag: jest.fn(),
      setContext: jest.fn(),
      setLevel: jest.fn(),
    });
  }),
  captureException: jest.fn(),
}));

const Sentry = require('@sentry/nestjs') as {
  withScope: jest.Mock;
  captureException: jest.Mock;
};

describe('DemoSeatSweeper', () => {
  let sweeper: DemoSeatSweeper;
  let demoSeats: {
    sweepExpired: jest.Mock;
    sendExpiryReminders: jest.Mock;
  };

  beforeEach(async () => {
    demoSeats = {
      sweepExpired: jest.fn().mockResolvedValue({
        scanned: 0,
        expired: 0,
        expiredIds: [],
      }),
      sendExpiryReminders: jest.fn().mockResolvedValue({
        scanned: 0,
        sent: 0,
        skipped: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoSeatSweeper,
        { provide: DemoSeatService, useValue: demoSeats },
      ],
    }).compile();

    sweeper = module.get<DemoSeatSweeper>(DemoSeatSweeper);
  });

  describe('runHourly', () => {
    it('invokes DemoSeatService.sweepExpired on every tick', async () => {
      await sweeper.runHourly();
      expect(demoSeats.sweepExpired).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there is nothing to expire (no log spam)', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await sweeper.runHourly();

      // Zero-expired runs should NOT emit the sweep summary log — we only
      // log when we actually did work, to keep the log stream quiet during
      // idle hours.
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'portal.demo_seat_sweep' }),
      );
      logSpy.mockRestore();
    });

    it('emits a structured log with counts when seats actually expired', async () => {
      demoSeats.sweepExpired.mockResolvedValue({
        scanned: 5,
        expired: 2,
        expiredIds: ['p1', 'p2'],
      });
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await sweeper.runHourly();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.demo_seat_sweep',
          scanned: 5,
          expired: 2,
          expiredIds: ['p1', 'p2'],
        }),
      );
      logSpy.mockRestore();
    });

    it('NEVER throws when DemoSeatService.sweepExpired rejects', async () => {
      // Cron handlers must never throw — an uncaught rejection kills the
      // scheduler in NestJS. We log and continue.
      demoSeats.sweepExpired.mockRejectedValue(new Error('DB connection lost'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await expect(sweeper.runHourly()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Demo seat sweep failed'),
        expect.any(String),
      );
      errorSpy.mockRestore();
    });

    it('escalates sweep failures to Sentry with structured tags', async () => {
      const dbError = new Error('DB connection lost');
      demoSeats.sweepExpired.mockRejectedValue(dbError);
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      // Swap in a scope spy that records how the scope was configured
      const scopeConfig: {
        tags: Record<string, string>;
        contexts: Record<string, any>;
        level?: string;
      } = { tags: {}, contexts: {} };
      Sentry.withScope.mockImplementationOnce((cb: any) => {
        const mockScope = {
          setTag: jest.fn((key: string, value: string) => {
            scopeConfig.tags[key] = value;
          }),
          setContext: jest.fn((key: string, value: any) => {
            scopeConfig.contexts[key] = value;
          }),
          setLevel: jest.fn((level: string) => {
            scopeConfig.level = level;
          }),
        };
        cb(mockScope);
      });

      await sweeper.runHourly();

      expect(Sentry.withScope).toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledWith(dbError);
      expect(scopeConfig.tags.component).toBe('portal.demo_seat_sweeper');
      expect(scopeConfig.tags.cron).toBe('hourly');
      expect(scopeConfig.contexts.sweeper).toEqual(
        expect.objectContaining({
          event: 'portal.demo_seat_sweep_failed',
        }),
      );
      expect(scopeConfig.level).toBe('error');
    });

    it('swallows Sentry errors so the cron never crashes', async () => {
      // Defense in depth: if Sentry itself throws (misconfigured, quota),
      // the cron handler must still return normally.
      demoSeats.sweepExpired.mockRejectedValue(new Error('DB lost'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      Sentry.withScope.mockImplementationOnce(() => {
        throw new Error('Sentry unavailable');
      });

      await expect(sweeper.runHourly()).resolves.toBeUndefined();
    });

    it('is idempotent across back-to-back calls', async () => {
      await sweeper.runHourly();
      await sweeper.runHourly();
      await sweeper.runHourly();

      expect(demoSeats.sweepExpired).toHaveBeenCalledTimes(3);
    });
  });

  describe('runDailyReminders', () => {
    it('invokes DemoSeatService.sendExpiryReminders on every tick', async () => {
      await sweeper.runDailyReminders();
      expect(demoSeats.sendExpiryReminders).toHaveBeenCalledTimes(1);
    });

    it('is a no-op log-wise when no reminders were sent', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await sweeper.runDailyReminders();

      expect(logSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'portal.demo_seat_reminder_sweep' }),
      );
      logSpy.mockRestore();
    });

    it('emits a structured log when reminders actually fired', async () => {
      demoSeats.sendExpiryReminders.mockResolvedValue({
        scanned: 5,
        sent: 3,
        skipped: 2,
      });
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await sweeper.runDailyReminders();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.demo_seat_reminder_sweep',
          scanned: 5,
          sent: 3,
          skipped: 2,
        }),
      );
      logSpy.mockRestore();
    });

    it('NEVER throws when sendExpiryReminders rejects', async () => {
      demoSeats.sendExpiryReminders.mockRejectedValue(
        new Error('Resend outage'),
      );
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(sweeper.runDailyReminders()).resolves.toBeUndefined();
    });

    it('escalates reminder failures to Sentry with cron=daily_reminder tag', async () => {
      const resendErr = new Error('Resend outage');
      demoSeats.sendExpiryReminders.mockRejectedValue(resendErr);
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const scopeConfig: {
        tags: Record<string, string>;
        contexts: Record<string, any>;
      } = { tags: {}, contexts: {} };
      Sentry.withScope.mockImplementationOnce((cb: any) => {
        const mockScope = {
          setTag: jest.fn((key: string, value: string) => {
            scopeConfig.tags[key] = value;
          }),
          setContext: jest.fn((key: string, value: any) => {
            scopeConfig.contexts[key] = value;
          }),
          setLevel: jest.fn(),
        };
        cb(mockScope);
      });

      await sweeper.runDailyReminders();

      expect(Sentry.captureException).toHaveBeenCalledWith(resendErr);
      expect(scopeConfig.tags.cron).toBe('daily_reminder');
      expect(scopeConfig.contexts.sweeper).toEqual(
        expect.objectContaining({
          event: 'portal.demo_seat_reminder_failed',
        }),
      );
    });
  });
});
