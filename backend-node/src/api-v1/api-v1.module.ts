import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { ApiV1Service } from './api-v1.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiRateLimitGuard } from './guards/api-rate-limit.guard';
import { AlmModule } from '../alm/alm.module';

@Module({
  imports: [AlmModule],
  controllers: [ApiV1Controller],
  providers: [ApiV1Service, ApiKeyAuthGuard, ApiRateLimitGuard],
})
export class ApiV1Module {}
