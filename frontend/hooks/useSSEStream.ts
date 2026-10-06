import { useState, useEffect, useRef, useCallback } from 'react';

export interface SSEStreamState {
  text: string;
  isStreaming: boolean;
  error: string | null;
  start: (url: string) => void;
  reset: () => void;
}

export function useSSEStream(): SSEStreamState {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const start = useCallback((url: string) => {
    if (esRef.current) esRef.current.close();
    setIsStreaming(true);
    setText('');
    setError(null);

    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'token' && data.token) {
          setText((prev) => prev + data.token);
        } else if (data.type === 'done') {
          setIsStreaming(false);
          es.close();
        } else if (data.type === 'error') {
          setError(data.message ?? 'Stream error');
          setIsStreaming(false);
          es.close();
        }
      } catch {
        // Non-JSON message, append as text
        setText((prev) => prev + e.data);
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };
  }, []);

  const reset = useCallback(() => {
    if (esRef.current) esRef.current.close();
    setText('');
    setIsStreaming(false);
    setError(null);
  }, []);

  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  return { text, isStreaming, error, start, reset };
}
