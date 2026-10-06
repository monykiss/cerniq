import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditService } from './audit.service';
import {
  AdminAuditController,
  PortalAuditController,
} from './audit.controller';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AdminAuditController, PortalAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
