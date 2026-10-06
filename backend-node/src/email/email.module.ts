import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailService } from './email.service';
import { EmailSequenceProcessor } from './email-sequence.processor';

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [EmailService, EmailSequenceProcessor],
  exports: [EmailService],
})
export class EmailModule {}
