import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DataRetentionService } from './data-retention.service';

/**
 * Scheduled background work.
 *
 * This module also hosted `DailyPipelineService` — an end-of-market-close EOD
 * job that fanned out over tickers via MarketData/Risk — plus the two
 * controllers that existed only to trigger and report on it. All three went
 * with the trading product line; `ScheduleModule.forRoot()` stays because
 * `DataRetentionService` is cron-driven.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class JobsModule {}
