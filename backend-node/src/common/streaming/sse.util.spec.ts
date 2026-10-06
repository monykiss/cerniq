import { createSSEStream } from './sse.util';
import { firstValueFrom, toArray, lastValueFrom } from 'rxjs';

describe('createSSEStream', () => {
  async function* makeGenerator(tokens: string[]): AsyncGenerator<string> {
    for (const token of tokens) {
      yield token;
    }
  }

  async function* makeFailingGenerator(
    tokens: string[],
    errorMsg: string,
  ): AsyncGenerator<string> {
    for (const token of tokens) {
      yield token;
    }
    throw new Error(errorMsg);
  }

  it('emits token events for each yielded string', async () => {
    const gen = makeGenerator(['Hello', ' ', 'World']);
    const observable = createSSEStream(gen);

    const events: any[] = [];
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: resolve,
      });
    });

    expect(events.length).toBe(4); // 3 tokens + 1 done
    expect(events[0].data).toEqual({ token: 'Hello', type: 'token' });
    expect(events[1].data).toEqual({ token: ' ', type: 'token' });
    expect(events[2].data).toEqual({ token: 'World', type: 'token' });
  });

  it('emits a done event after all tokens', async () => {
    const gen = makeGenerator(['one']);
    const observable = createSSEStream(gen);

    const events: any[] = [];
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: resolve,
      });
    });

    const lastEvent = events[events.length - 1];
    expect(lastEvent.data).toEqual({ type: 'done' });
  });

  it('completes the observable after done event', async () => {
    const gen = makeGenerator(['a']);
    const observable = createSSEStream(gen);

    let completed = false;
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: () => {},
        error: reject,
        complete: () => {
          completed = true;
          resolve();
        },
      });
    });

    expect(completed).toBe(true);
  });

  it('emits an error event when generator throws', async () => {
    const gen = makeFailingGenerator(['partial'], 'Stream broke');
    const observable = createSSEStream(gen);

    const events: any[] = [];
    let errorCaught: any = null;

    await new Promise<void>((resolve) => {
      observable.subscribe({
        next: (event) => events.push(event),
        error: (err) => {
          errorCaught = err;
          resolve();
        },
        complete: resolve,
      });
    });

    // Should have the token event and the error event
    const errorEvent = events.find((e) => e.data?.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data.message).toBe('Stream broke');
    expect(errorCaught).toBeDefined();
  });

  it('handles an empty generator', async () => {
    const gen = makeGenerator([]);
    const observable = createSSEStream(gen);

    const events: any[] = [];
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: resolve,
      });
    });

    expect(events.length).toBe(1);
    expect(events[0].data).toEqual({ type: 'done' });
  });

  it('emits error with fallback message when error has no message', async () => {
    async function* badGen(): AsyncGenerator<string> {
      const shouldYield = Date.now() < 0;
      if (shouldYield) {
        yield '';
      }
      const error = new Error('');
      throw error;
    }

    const observable = createSSEStream(badGen());
    const events: any[] = [];

    await new Promise<void>((resolve) => {
      observable.subscribe({
        next: (event) => events.push(event),
        error: () => resolve(),
        complete: resolve,
      });
    });

    const errorEvent = events.find((e) => e.data?.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data.message).toBe('Stream error');
  });
});
