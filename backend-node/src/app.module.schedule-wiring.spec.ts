import 'reflect-metadata';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module';

// Regression guard for the Wave-03 agent scheduler.
//
// `@nestjs/schedule` requires `ScheduleModule.forRoot()` to be imported at
// the composition root (the AppModule). Without it, every `@Cron(...)`
// decorator is silently ignored — no runtime error, no log line, the
// handlers just never fire. AgentSchedulerService's daily/weekly/monthly
// risk-monitor cadences are the "subscription anchor" of the agentic
// product (Vol.3 §Sprint 2), so this is a boot-time correctness check
// that must stay green.
//
// We introspect the module metadata directly rather than bootstrapping a
// TestingModule because (1) we're testing a wiring fact, not behavior,
// and (2) bootstrapping the full AppModule in a unit test is needlessly
// slow given the ~40 feature modules it imports.
describe('AppModule — scheduler wiring', () => {
  it('imports ScheduleModule so @Cron decorators are discovered', () => {
    const imports = (Reflect.getMetadata('imports', AppModule) ??
      []) as unknown[];

    // `ScheduleModule.forRoot()` returns a DynamicModule whose `module`
    // property is the `ScheduleModule` class. Accept either the class
    // itself (defensive) or the dynamic-module shape.
    const hasSchedule = imports.some((entry) => {
      if (entry === ScheduleModule) return true;
      if (entry && typeof entry === 'object' && 'module' in entry) {
        return (entry as { module: unknown }).module === ScheduleModule;
      }
      return false;
    });

    expect(hasSchedule).toBe(true);
  });
});
