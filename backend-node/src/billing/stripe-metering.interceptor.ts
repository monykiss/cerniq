import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

// ─── Stripe Usage Metering Interceptor ──────────────────────
// Intercepts API calls and records billable usage events
// In production: emits Stripe Meter API events via stripe.billing.meterEvents.create()

const BILLABLE_ENDPOINTS: Record<string, string> = {
  'POST /api/alm/:id/monte-carlo/run': 'compute_job',
  'POST /api/alm/:id/optimize': 'compute_job',
  'GET /api/alm/:id/var': 'compute_job',
  'GET /api/alm/:id/oas': 'compute_job',
  'GET /api/alm/:id/credit-risk': 'compute_job',
  'GET /api/alm/:id/board-report': 'report_generated',
  'GET /api/alm/:id/form-5300': 'report_generated',
  'GET /api/alm/:id/exam-prep': 'report_generated',
  'GET /api/alm/:id/report': 'report_generated',
};

// Track usage in-memory (production: emit to Stripe Meter API)
const usageLog: Array<{
  institutionId: string;
  eventType: string;
  timestamp: number;
}> = [];

@Injectable()
export class StripeMeteringInterceptor implements NestInterceptor {
  private readonly logger = new Logger(StripeMeteringInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const path = request.route?.path ?? request.url;

    return next.handle().pipe(
      tap({
        next: () => {
          // Check if this endpoint is billable
          const routeKey = `${method} ${path}`;
          for (const [pattern, eventType] of Object.entries(
            BILLABLE_ENDPOINTS,
          )) {
            if (this.matchesPattern(routeKey, pattern)) {
              const institutionId = request.params?.institutionId;
              if (institutionId) {
                this.recordUsage(institutionId, eventType);
              }
              break;
            }
          }

          // Always count API calls for v1 endpoints
          if (path.startsWith('/api/v1/')) {
            const institutionId =
              request.params?.institutionId ??
              request.headers?.['x-institution-id'];
            if (institutionId) {
              this.recordUsage(institutionId, 'api_call');
            }
          }
        },
      }),
    );
  }

  private matchesPattern(actual: string, pattern: string): boolean {
    const regex = pattern
      .replace(/:id/g, '[^/]+')
      .replace(/:institutionId/g, '[^/]+');
    return new RegExp(`^${regex}$`).test(actual);
  }

  private recordUsage(institutionId: string, eventType: string) {
    usageLog.push({ institutionId, eventType, timestamp: Date.now() });

    // In production, emit to Stripe:
    // await stripe.billing.meterEvents.create({
    //   event_name: eventType,
    //   payload: { stripe_customer_id: customerMapping[institutionId], value: '1' },
    // });

    this.logger.debug(`Usage: ${eventType} for ${institutionId}`);
  }
}

// ─── Get Usage Summary ──────────────────────────────────────

export function getUsageLog(
  institutionId?: string,
  since?: number,
): typeof usageLog {
  let filtered = usageLog;
  if (institutionId)
    filtered = filtered.filter((e) => e.institutionId === institutionId);
  if (since) filtered = filtered.filter((e) => e.timestamp >= since);
  return filtered;
}
