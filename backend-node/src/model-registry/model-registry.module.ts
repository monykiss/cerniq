/**
 * ModelRegistryModule — FAANG Audit P1: Formal model governance.
 *
 * Provides the ModelRegistryService (CRUD + approve/retire workflow)
 * and the ModelRegistryController (REST API). The ModelRegistrySeeder
 * populates the registry with all production models on boot via OnModuleInit.
 *
 * Import this module from AppModule. No other module needs to import it —
 * the registry is accessed via the HTTP API or directly via the service
 * for preflight integration.
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { ModelRegistryService } from './model-registry.service';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistrySeeder } from './model-registry.seeder';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [
    ModelRegistryService,
    ModelRegistrySeeder,
    PrismaService,
    AuthGuard,
  ],
  controllers: [ModelRegistryController],
  exports: [ModelRegistryService],
})
export class ModelRegistryModule {}
