import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CossecIngestController } from './cossec-ingest.controller';
import { SampleReportController } from './sample-report.controller';
import { CossecIngestService } from './cossec-ingest.service';
import { CossecMatchingService } from './cossec-matching.service';
import { SampleReportService } from './sample-report.service';
import { SampleReportQueueService } from './sample-report-queue.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '72h' },
    }),
  ],
  controllers: [CossecIngestController, SampleReportController],
  providers: [
    CossecIngestService,
    CossecMatchingService,
    SampleReportService,
    SampleReportQueueService,
  ],
  exports: [CossecIngestService, SampleReportService],
})
export class CossecModule {}
