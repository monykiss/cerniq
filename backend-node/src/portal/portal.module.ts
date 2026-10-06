import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PortalController } from './portal.controller';
import { AlmModule } from '../alm/alm.module';
import { EmailModule } from '../email/email.module';
import { BillingModule } from '../billing/billing.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AuditModule } from '../audit/audit.module';
import { PortalDocumentExportsService } from './portal-document-exports.service';
import { PortalAlmReportService } from './portal-alm-report.service';
import { DemoSeatService } from './demo-seat.service';
import { DemoSeatSweeper } from './demo-seat.sweeper';
import { DemoSeatAnalyticsService } from './demo-seat-analytics.service';
import { DemoSeatEngagementService } from './demo-seat-engagement.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
    ScheduleModule.forRoot(),
    AlmModule,
    EmailModule,
    BillingModule,
    PipelineModule,
    AuditModule,
  ],
  controllers: [PortalController],
  providers: [
    PortalDocumentExportsService,
    PortalAlmReportService,
    DemoSeatService,
    DemoSeatSweeper,
    DemoSeatAnalyticsService,
    DemoSeatEngagementService,
  ],
  exports: [
    DemoSeatService,
    PortalAlmReportService,
    DemoSeatAnalyticsService,
    DemoSeatEngagementService,
  ],
})
export class PortalModule {}
