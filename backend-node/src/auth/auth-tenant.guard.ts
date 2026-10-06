import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { TenantScopeGuard } from '../common/guards/tenant-scope.guard';

/**
 * Runs {@link AuthGuard} then {@link TenantScopeGuard} so `request.user` is
 * populated before tenant fail-closed checks (global guards alone cannot rely
 * on per-route-only auth completing first).
 */
@Injectable()
export class AuthTenantGuard implements CanActivate {
  private readonly logger = new Logger(AuthTenantGuard.name);

  constructor(
    private readonly authGuard: AuthGuard,
    private readonly tenantScopeGuard: TenantScopeGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const okAuth = await this.authGuard.canActivate(context);
    if (!okAuth) {
      return false;
    }

    try {
      return this.tenantScopeGuard.canActivate(context);
    } catch (err: unknown) {
      this.logger.warn(
        { err: String(err) },
        'tenant scope guard threw after authentication',
      );
      throw err;
    }
  }
}
