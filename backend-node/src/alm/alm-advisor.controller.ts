import {
  Controller,
  Post,
  Body,
  Param,
  Logger,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AlmAdvisorService } from './alm-advisor.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

class AskAdvisorDto {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  language?: 'es' | 'en';
}

@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class AlmAdvisorController {
  private readonly logger = new Logger(AlmAdvisorController.name);

  constructor(private readonly advisor: AlmAdvisorService) {}

  @Post(':institutionId/advisor')
  @UseGuards(AuthTenantGuard)
  @HttpCode(200)
  async askAdvisor(
    @Param('institutionId') institutionId: string,
    @Body() dto: AskAdvisorDto,
  ): Promise<unknown> {
    this.logger.log(
      `AI Advisor query for institution ${institutionId}: "${(dto.message || '').slice(0, 80)}..."`,
    );

    const result = await this.advisor.ask(
      institutionId,
      dto.message,
      dto.conversationHistory || [],
      dto.language || 'es',
    );

    return result;
  }
}
