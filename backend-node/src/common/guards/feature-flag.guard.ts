import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const FEATURE_FLAG_KEY = 'featureFlag';

/**
 * Feature flag guard for gradual rollouts.
 * Checks whether a feature flag is enabled before allowing execution.
 * Feature flags are read from environment variables prefixed with FEATURE_.
 *
 * Usage with decorator:
 * @SetMetadata('featureFlag', 'NEW_DASHBOARD')
 * @UseGuards(FeatureFlagGuard)
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  private readonly logger = new Logger(FeatureFlagGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const flagName = this.reflector.getAllAndOverride<string>(
      FEATURE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!flagName) {
      // No feature flag metadata — allow access
      return true;
    }

    const envKey = `FEATURE_${flagName.toUpperCase()}`;
    const flagValue = process.env[envKey];
    const isEnabled = flagValue === 'true' || flagValue === '1';

    if (!isEnabled) {
      this.logger.debug(
        `Feature flag ${flagName} is disabled — blocking access`,
      );
      throw new ForbiddenException(
        `This feature is not yet available. Flag: ${flagName}`,
      );
    }

    this.logger.debug(`Feature flag ${flagName} is enabled — allowing access`);
    return true;
  }
}
