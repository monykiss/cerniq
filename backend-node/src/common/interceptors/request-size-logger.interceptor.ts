import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Logs request and response payload sizes for bandwidth monitoring.
 * Helps identify oversized payloads, detect abuse, and plan capacity.
 * Logs warnings when payloads exceed configurable thresholds.
 */
@Injectable()
export class RequestSizeLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestSizeLoggerInterceptor.name);
  private readonly warnThresholdBytes: number;

  constructor(warnThresholdKB = 512) {
    this.warnThresholdBytes = warnThresholdKB * 1024;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const requestSize = this.getContentLength(req);
    const method = req.method;
    const url = req.url;

    if (requestSize > this.warnThresholdBytes) {
      this.logger.warn(
        `Large request: ${method} ${url} — ${this.formatBytes(requestSize)}`,
      );
    }

    return next.handle().pipe(
      tap((responseBody) => {
        const responseSize = responseBody
          ? Buffer.byteLength(JSON.stringify(responseBody), 'utf8')
          : 0;

        if (responseSize > this.warnThresholdBytes) {
          this.logger.warn(
            `Large response: ${method} ${url} — ${this.formatBytes(responseSize)}`,
          );
        }

        this.logger.debug(
          `${method} ${url} — req: ${this.formatBytes(requestSize)}, res: ${this.formatBytes(responseSize)}`,
        );
      }),
    );
  }

  private getContentLength(req: any): number {
    const contentLength = req.headers['content-length'];
    return contentLength ? parseInt(contentLength, 10) : 0;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}
