import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PipelineWorker } from './pipeline.worker';
import { PipelineHealthMonitor } from './pipeline-health.monitor';
import { PipelineController } from './pipeline.controller';
import { ReportStorageService } from './report-storage.service';
import { AlcoPackService } from './alco-pack.service';
import { EmailModule } from '../email/email.module';
import { AlmModule } from '../alm/alm.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ScheduleModule.forRoot(), EmailModule, AlmModule, RealtimeModule],
  controllers: [PipelineController],
  providers: [
    PipelineWorker,
    PipelineHealthMonitor,
    ReportStorageService,
    AlcoPackService,
  ],
  exports: [PipelineWorker, ReportStorageService, AlcoPackService],
})
export class PipelineModule {}
