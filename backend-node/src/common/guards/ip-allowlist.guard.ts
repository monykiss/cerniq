import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

/**
 * IP allowlist guard for admin endpoint restriction.
 * Only allows requests from pre-approved IP addresses.
 * Configurable via IP_ALLOWLIST environment variable (comma-separated).
 * Always allows localhost/loopback for development.
 */
@Injectable()
export class IpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(IpAllowlistGuard.name);
  private readonly localhostIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const clientIp = this.extractIp(request);

    // Always allow localhost in development
    if (this.localhostIPs.includes(clientIp)) {
      return true;
    }

    const allowlist = this.getAllowlist();
    if (allowlist.length === 0) {
      this.logger.warn(
        'IP_ALLOWLIST not configured — blocking all non-local requests',
      );
      throw new ForbiddenException('Access denied');
    }

    if (!allowlist.includes(clientIp)) {
      this.logger.warn(`Blocked request from unauthorized IP: ${clientIp}`);
      throw new ForbiddenException('Access denied');
    }

    return true;
  }

  private extractIp(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip || request.connection?.remoteAddress || '';
  }

  private getAllowlist(): string[] {
    const raw = process.env.IP_ALLOWLIST || '';
    return raw
      .split(',')
      .map((ip: string) => ip.trim())
      .filter(Boolean);
  }
}
