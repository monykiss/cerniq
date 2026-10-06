import { Module } from '@nestjs/common';
import { ComplianceRegistryService } from './compliance-registry.service';
import { ComplianceRegistryController } from './compliance-registry.controller';

@Module({
  controllers: [ComplianceRegistryController],
  providers: [ComplianceRegistryService],
  exports: [ComplianceRegistryService],
})
export class ComplianceRegistryModule {}
