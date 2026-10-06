import {
  Controller,
  Get,
  Param,
  Query,
  Sse,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AlmAdvisorV2Service } from './alm-advisor-v2.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { createSSEStream } from '../common/streaming/sse.util';

@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class AlmAdvisorV2Controller {
  private readonly logger = new Logger(AlmAdvisorV2Controller.name);

  constructor(private readonly advisorV2: AlmAdvisorV2Service) {}

  @Sse(':institutionId/advisor/stream')
  @UseGuards(AuthTenantGuard)
  streamAdvisor(
    @Param('institutionId') institutionId: string,
    @Query('lang') lang = 'en',
  ): Observable<MessageEvent> {
    this.logger.log(
      `Streaming advisor narrative for ${institutionId} (lang=${lang})`,
    );
    return createSSEStream(this.advisorV2.streamNarrative(institutionId, lang));
  }

  @Get(':institutionId/advisor/health-score')
  @UseGuards(AuthTenantGuard)
  async getHealthScore(@Param('institutionId') institutionId: string) {
    return this.advisorV2.computeHealthScore(institutionId);
  }

  @Get(':institutionId/advisor/narrative')
  @UseGuards(AuthTenantGuard)
  async getStaticNarrative(
    @Param('institutionId') institutionId: string,
    @Query('lang') lang = 'en',
  ) {
    return this.advisorV2.getStaticNarrative(institutionId, lang);
  }
}
