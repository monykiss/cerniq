import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { hashApiKey } from '../../auth/api-key.util';
import { PlatformAccessService } from '../../auth/platform-access.service';

export type ApiKeyUser = {
  userId: string;
  email: string;
  apiKeyId: string;
  keyPrefix: string;
  tier: 'standard' | 'partner';
};

/**
 * Guard for Public API v1 endpoints.
 * Reads the API key from either `Authorization: Bearer <api-key>` (the
 * canonical Public API convention) or `X-Api-Key: <api-key>` (the
 * legacy Enterprise-tier convention introduced before this guard
 * existed). Bearer takes precedence when both are present.
 *
 * Hashes the key via `hashApiKey()` (HMAC-SHA256 with pepper —
 * `auth/api-key.util.ts`), looks it up in the ApiKey table, validates
 * it is active, and updates lastUsedAt.
 *
 * Unlike the main AuthGuard, this guard:
 *  - Only supports API key auth (no JWT/cookie)
 *  - Allows POST/PUT/DELETE (the main guard restricts API keys to read-only)
 *  - Attaches a minimal `ApiKeyUser` to req.apiUser
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformAccess: PlatformAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawToken = this.extractApiKey(request);

    if (!rawToken) {
      throw new UnauthorizedException(
        'Missing API key. Provide Authorization: Bearer <api-key> or X-Api-Key header',
      );
    }

    const keyHash = hashApiKey(rawToken);

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            subscription: { select: { tier: true, status: true } },
          },
        },
      },
    });

    if (!key || !key.user) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (key.revokedAt) {
      throw new ForbiddenException('API key has been revoked');
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new ForbiddenException('API key has expired');
    }

    // Update lastUsedAt (best-effort)
    this.prisma.apiKey
      .update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        /* best-effort */
      });

    // Determine tier from subscription
    const subTier = key.user.subscription?.tier;
    const tier: 'standard' | 'partner' =
      subTier === 'partner' || subTier === 'annual' ? 'partner' : 'standard';

    const apiUser: ApiKeyUser = {
      userId: key.user.id,
      email: key.user.email,
      apiKeyId: key.id,
      keyPrefix: key.keyPrefix,
      tier,
    };

    // API keys never carry platform-admin privilege: access is evaluated on
    // the key owner's subscription only.
    const access = this.platformAccess.evaluateAccess({
      subscription: key.user.subscription,
      platformAdmin: false,
    });
    if (!access.platformAccessAllowed) {
      throw new ForbiddenException(
        this.platformAccess.buildForbiddenPayload(access),
      );
    }

    request.apiUser = apiUser;

    // Also attach as request.user for compatibility with response envelope
    request.user = {
      userId: key.user.id,
      email: key.user.email,
      role: 'api_key',
      claims: { auth_method: 'api_key', api_key_id: key.id },
      orgId: null,
      authMethod: 'api_key',
      access,
    };

    return true;
  }

  private extractApiKey(request: any): string | null {
    // Preferred: `Authorization: Bearer <api-key>` (Public API v1 convention).
    const authHeader = request.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) return token;
    }

    // Fallback: `X-Api-Key: <api-key>` (legacy Enterprise convention; kept
    // for backward compatibility with EnterpriseController callers that
    // pre-date this guard).
    const xApiKey = request.headers?.['x-api-key'];
    if (typeof xApiKey === 'string') {
      const token = xApiKey.trim();
      if (token) return token;
    }

    return null;
  }
}
