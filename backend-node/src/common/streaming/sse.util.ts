import { Observable } from 'rxjs';

export interface SSEData {
  token?: string;
  type: 'token' | 'done' | 'error';
  message?: string;
}

/**
 * Wraps an AsyncGenerator<string> into an Observable<MessageEvent> for NestJS @Sse().
 * Each yielded string becomes an SSE "token" event; completion sends "done".
 */
export function createSSEStream(
  generator: AsyncGenerator<string>,
): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    void (async () => {
      try {
        for await (const token of generator) {
          subscriber.next({ data: { token, type: 'token' } } as any);
        }
        subscriber.next({ data: { type: 'done' } } as any);
        subscriber.complete();
      } catch (err: any) {
        subscriber.next({
          data: { type: 'error', message: err.message || 'Stream error' },
        } as any);
        subscriber.error(err);
      }
    })();
  });
}

/**
 * Wraps an AsyncGenerator<T> of structured events into Observable<MessageEvent>.
 * Each yielded object is sent as-is (it already has its own `type` field).
 * Used by the CERNIQ Analyst which emits {type:'token'|'tool_use'|'done'|'error'}.
 */
export function createStructuredSSEStream<T>(
  generator: AsyncGenerator<T>,
): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    void (async () => {
      try {
        for await (const event of generator) {
          subscriber.next({ data: event } as any);
        }
        subscriber.complete();
      } catch (err: any) {
        subscriber.next({
          data: { type: 'error', message: err.message || 'Stream error' },
        } as any);
        subscriber.error(err);
      }
    })();
  });
}
