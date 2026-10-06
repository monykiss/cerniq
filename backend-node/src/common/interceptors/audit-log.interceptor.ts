import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma.service';
import {
  AUDIT_ACTION_KEY,
  SKIP_AUDIT_LOG_KEY,
} from '../decorators/audit-action.decorator';

const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

const REDACTED = '[REDACTED]';
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'api_key',
  'apikey',
  'refresh',
];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method?.toUpperCase();
    const explicitAction =
      this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || null;
    const skipAudit =
      this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_LOG_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (skipAudit) {
      return next.handle();
    }

    const action = explicitAction || METHOD_ACTION_MAP[method];
    if (!action) {
      return next.handle();
    }

    const userId = request.user?.userId || null;
    const resource = this.extractResource(request.route?.path || request.url);
    const resourceId =
      request.params?.id ||
      request.params?.institutionId ||
      request.params?.runId ||
      request.params?.jobId ||
      request.params?.scenarioId ||
      request.params?.webhookId ||
      request.params?.keyId ||
      null;
    const institutionId =
      request.params?.institutionId ||
      request.body?.institutionId ||
      request.query?.institutionId ||
      null;
    const ipAddress =
      request.ip || request.headers?.['x-forwarded-for'] || null;
    const userAgent = request.headers?.['user-agent'] || null;
    const tenantId = request.user?.orgId || null;
    const changes =
      method === 'DELETE' || method === 'GET' || method === 'HEAD'
        ? null
        : this.sanitizePayload(request.body);

    const commonFields = {
      userId,
      institutionId,
      action,
      resource,
      resourceId,
      ipAddress: typeof ipAddress === 'string' ? ipAddress : null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      tenantId,
      changes,
      metadata: {
        method,
        route: request.route?.path || request.url,
        ...(explicitAction ? { explicitAction: true } : {}),
      },
    };

    return next.handle().pipe(
      tap({
        next: () => {
          this.persistAuditLog({
            ...commonFields,
            outcome: 'success',
          });
        },
        error: (err: any) => {
          this.persistAuditLog({
            ...commonFields,
            outcome: 'failure',
            errorMessage: err?.message || 'Unknown error',
            errorStatus: err?.status || err?.getStatus?.() || 500,
          });
        },
      }),
    );
  }

  private extractResource(routePath: string): string {
    return routePath
      .replace(/^\/api\//, '')
      .replace(/\/:[^/]+/g, '')
      .replace(/\//g, '_')
      .replace(/-/g, '_')
      .toLowerCase();
  }

  private sanitizePayload(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }
    if (Buffer.isBuffer(value)) {
      return `[binary:${value.length}]`;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizePayload(item));
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
        const normalized = key.toLowerCase();
        if (
          SENSITIVE_FIELD_PATTERNS.some((pattern) =>
            normalized.includes(pattern),
          )
        ) {
          return [key, REDACTED];
        }
        return [key, this.sanitizePayload(inner)];
      }),
    );
  }

  private persistAuditLog(data: {
    userId: string | null;
    institutionId: string | null;
    action: string;
    resource: string;
    resourceId: string | null;
    changes?: any;
    ipAddress: string | null;
    userAgent: string | null;
    tenantId: string | null;
    metadata?: Record<string, unknown>;
    outcome?: string;
    errorMessage?: string;
    errorStatus?: number;
  }): void {
    const metadata = {
      ...(data.metadata || {}),
      ...(data.errorMessage ? { _audit_error: data.errorMessage } : {}),
      ...(data.errorStatus ? { _audit_error_status: data.errorStatus } : {}),
    };

    this.prisma.auditLog
      .create({
        data: {
          userId: data.userId,
          institutionId: data.institutionId,
          action: data.action,
          resource: data.resource,
          resourceId: data.resourceId,
          outcome: data.outcome || 'success',
          changes: data.changes || null,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          tenantId: data.tenantId,
        },
      })
      .then(() => {
        const tag = data.outcome === 'failure' ? 'FAIL' : 'OK';
        this.logger.debug(
          `Audit [${tag}]: ${data.action} ${data.resource} ${data.resourceId || '(no id)'} by ${data.userId || 'anonymous'}`,
        );
      })
      .catch((err: any) => {
        this.logger.error(`Failed to persist audit log: ${err.message}`);
      });
  }
}
