import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Metadata key for required subscription tiers.
 */
export const SUBSCRIPTION_TIER_KEY = 'subscription_tier';

/**
 * Decorator to set the minimum subscription tier for an endpoint.
 */
import { SetMetadata } from '@nestjs/common';
export const RequiresTier = (...tiers: string[]) =>
  SetMetadata(SUBSCRIPTION_TIER_KEY, tiers);

/**
 * Tier hierarchy for comparison. Higher index = higher tier.
 */
const TIER_HIERARCHY = ['free', 'starter', 'professional', 'enterprise'];

/**
 * Guard that checks if the user's subscription tier meets the minimum requirement.
 * Requires the user object to have a `subscriptionTier` property.
 */
@Injectable()
export class SubscriptionTierGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionTierGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTiers = this.reflector.getAllAndOverride<string[]>(
      SUBSCRIPTION_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredTiers || requiredTiers.length === 0) {
      return true; // No tier requirement — allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.subscriptionTier) {
      this.logger.warn('User has no subscription tier set');
      throw new ForbiddenException(
        'Subscription required to access this feature',
      );
    }

    const userTierIndex = TIER_HIERARCHY.indexOf(user.subscriptionTier);
    const meetsRequirement = requiredTiers.some((tier) => {
      const requiredIndex = TIER_HIERARCHY.indexOf(tier);
      return userTierIndex >= requiredIndex;
    });

    if (!meetsRequirement) {
      this.logger.warn(
        `User tier "${user.subscriptionTier}" insufficient for tiers: ${requiredTiers.join(', ')}`,
      );
      throw new ForbiddenException(
        `This feature requires one of the following plans: ${requiredTiers.join(', ')}`,
      );
    }

    return true;
  }
}
