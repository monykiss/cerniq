import { Injectable, NestMiddleware, Logger } from '@nestjs/common';

/**
 * Enterprise request logging middleware.
 * Logs every request with structured fields for compliance audit trails.
 * Fields: timestamp, method, url, ip, userId, orgId, userAgent, duration.
 *
 * This supplements Pino HTTP logging with business-specific context
 * that auditors require for SOC2 and COSSEC compliance.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('AuditAccess');

  use(req: any, res: any, next: () => void) {
    const start = Date.now();

    // Capture response finish to log with duration
    res.on('finish', () => {
      const duration = Date.now() - start;
      const userId = req.user?.userId || 'anonymous';
      const orgId = req.user?.orgId || req.headers['x-organization-id'] || null;

      // Only log non-health endpoints to reduce noise
      if (req.url === '/health' || req.url === '/ready') return;

      this.logger.log({
        event: 'api_access',
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration,
        userId,
        orgId,
        ip: req.ip,
        requestId: req.headers['x-request-id'] || req.id,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      });
    });

    next();
  }
}
