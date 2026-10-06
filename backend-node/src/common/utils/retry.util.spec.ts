import { retry } from './retry.util';

// Suppress NestJS logger output during tests
jest.mock('@nestjs/common', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  })),
}));

describe('retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds eventually', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    const promise = retry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      backoffMultiplier: 1,
    });

    // Advance timers for each retry delay
    for (let i = 0; i < 3; i++) {
      await Promise.resolve(); // flush microtasks
      jest.advanceTimersByTime(50);
    }

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max attempts exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    const promise = retry(fn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      backoffMultiplier: 1,
    });

    // Advance past retries
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(50);
    }

    await expect(promise).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses default maxAttempts of 3', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    const promise = retry(fn, {
      initialDelayMs: 10,
      backoffMultiplier: 1,
    });

    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(50);
    }

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('skips retry when retryIf returns false', async () => {
    const nonRetryableError = new Error('non-retryable');
    const fn = jest.fn().mockRejectedValue(nonRetryableError);

    const promise = retry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      retryIf: () => false,
    });

    await expect(promise).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects retryIf predicate for selective retry', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('fatal'));

    const promise = retry(fn, {
      maxAttempts: 5,
      initialDelayMs: 10,
      backoffMultiplier: 1,
      retryIf: (err) => err.message === 'timeout',
    });

    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(50);
    }

    await expect(promise).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
