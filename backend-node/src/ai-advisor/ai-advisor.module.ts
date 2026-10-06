import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiAdvisorService } from './ai-advisor.service';
import { ConversationHistoryService } from './conversation-history.service';
import { AiAdvisorController } from './ai-advisor.controller';
import { AiAdvisorGateway } from './ai-advisor.gateway';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// AuthModule re-exports JwtModule, giving the WS gateway access to
// JwtService for handshake-time token verification (closes the CRITICAL
// auth bypass flagged by audit decision 84faea03).
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AiAdvisorController],
  providers: [
    AiAdvisorService,
    ConversationHistoryService,
    AiAdvisorGateway,
    InstitutionScopeGuard,
  ],
  exports: [AiAdvisorService],
})
export class AiAdvisorModule {}
