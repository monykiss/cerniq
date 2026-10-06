import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { trace, context as otelContext } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AGENT_RUN_ID, INSTITUTION_ID } from './semantic-conventions';

/**
 * Propagates request-scoped correlation IDs into the OTel active span so
 * agent runs triggered during this request are chained to the inbound HTTP
 * trace. Also surfaces the correlation ID in the response headers for
 * frontend-side correlation (the cockpit surfaces it in the trace viewer).
 */
@Injectable()
export class AgentCorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AgentCorrelationInterceptor.name);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { institutionId?: string };
      cerniqCorrelationId?: string;
    }>();
    const res = http.getResponse<{
      setHeader: (k: string, v: string) => void;
    }>();

    const incoming = single(req.headers['x-cerniq-correlation-id']);
    const correlationId = incoming ?? randomUUID();
    req.cerniqCorrelationId = correlationId;
    try {
      res.setHeader('x-cerniq-correlation-id', correlationId);
    } catch {
      // Non-HTTP context (websocket). Non-fatal.
    }

    const span = trace.getSpan(otelContext.active());
    if (span) {
      span.setAttribute('cerniq.correlation_id', correlationId);
      const institutionId =
        single(req.headers['x-institution-id']) ?? req.user?.institutionId;
      if (institutionId) span.setAttribute(INSTITUTION_ID, institutionId);
      const runId = single(req.headers['x-cerniq-agent-run-id']);
      if (runId) span.setAttribute(AGENT_RUN_ID, runId);
    }

    return next.handle().pipe(
      tap({
        error: (err) => {
          const s = trace.getSpan(otelContext.active());
          if (s) s.recordException(err as Error);
        },
      }),
    );
  }
}

function single(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
