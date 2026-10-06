import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AdminKeyGuard } from './admin-key.guard';
import { AuthTenantGuard } from './auth-tenant.guard';
import { RolesGuard } from './roles.guard';
import { TenantScopeGuard } from '../common/guards/tenant-scope.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { PlatformAccessService } from './platform-access.service';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AdminKeyGuard,
    TenantScopeGuard,
    AuthTenantGuard,
    RolesGuard,
    PlatformAccessService,
    JwtStrategy,
    GoogleStrategy,
    GithubStrategy,
  ],
  exports: [
    AuthService,
    AuthGuard,
    AdminKeyGuard,
    TenantScopeGuard,
    AuthTenantGuard,
    RolesGuard,
    PlatformAccessService,
    JwtModule,
  ],
})
export class AuthModule {}
