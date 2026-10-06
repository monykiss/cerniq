/**
 * ActionsModule — Phase 3 (Action Registry).
 *
 * The module is intentionally minimal: it provides + exports the
 * `ActionRegistryService` and mounts the HTTP controller. Other modules
 * (AlmModule, etc.) IMPORT this module to get access to the registry,
 * then call `register()` from their own `onModuleInit` to wire their
 * actions in. There's no global side effect on import — modules opt in.
 *
 * The registry is process-local. In a horizontally scaled deployment,
 * each Node process maintains its own copy. That's fine because:
 *   - Action handlers are stateless (they call into other services).
 *   - Audit log writes go to the shared database.
 *   - Permission checks read the same JWT every process.
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { ActionRegistryService } from './action-registry.service';
import { ActionController } from './action.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [ActionRegistryService, PrismaService, AuthGuard],
  controllers: [ActionController],
  exports: [ActionRegistryService],
})
export class ActionsModule {}
