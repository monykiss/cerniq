import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSSEStream } from './useSSEStream';

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  // Helper to simulate a message event
  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  // Helper to simulate an error
  simulateError() {
    if (this.onerror) {
      this.onerror();
    }
  }
}

describe('useSSEStream', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useSSEStream());

    expect(result.current.text).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('sets isStreaming to true when start is called', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.text).toBe('');
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('https://api.test/stream');
  });

  it('accumulates tokens from stream messages', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateMessage(JSON.stringify({ type: 'token', token: 'Hello' }));
    });

    act(() => {
      es.simulateMessage(JSON.stringify({ type: 'token', token: ' World' }));
    });

    expect(result.current.text).toBe('Hello World');
    expect(result.current.isStreaming).toBe(true);
  });

  it('sets isStreaming to false on done message', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateMessage(JSON.stringify({ type: 'token', token: 'data' }));
    });

    act(() => {
      es.simulateMessage(JSON.stringify({ type: 'done' }));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(es.close).toHaveBeenCalled();
  });

  it('handles error messages from the stream', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateMessage(
        JSON.stringify({ type: 'error', message: 'Something went wrong' })
      );
    });

    expect(result.current.error).toBe('Something went wrong');
    expect(result.current.isStreaming).toBe(false);
    expect(es.close).toHaveBeenCalled();
  });

  it('handles EventSource connection errors', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateError();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(es.close).toHaveBeenCalled();
  });

  it('appends raw text for non-JSON messages', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateMessage('plain text message');
    });

    expect(result.current.text).toBe('plain text message');
  });

  it('resets state when reset is called', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateMessage(JSON.stringify({ type: 'token', token: 'Hello' }));
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.text).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(es.close).toHaveBeenCalled();
  });

  it('closes previous EventSource when start is called again', () => {
    const { result } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream1');
    });

    const firstEs = MockEventSource.instances[0];

    act(() => {
      result.current.start('https://api.test/stream2');
    });

    expect(firstEs.close).toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toBe('https://api.test/stream2');
  });

  it('closes EventSource on unmount', () => {
    const { result, unmount } = renderHook(() => useSSEStream());

    act(() => {
      result.current.start('https://api.test/stream');
    });

    const es = MockEventSource.instances[0];

    unmount();

    expect(es.close).toHaveBeenCalled();
  });
});
