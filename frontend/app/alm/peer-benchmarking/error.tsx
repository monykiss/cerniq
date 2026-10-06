'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function PeerBenchmarkingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-[400px] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-400 mb-4">
          The peer benchmarking module encountered an error. Our team has been notified.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-slate-600 mb-4">ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="rounded-full bg-cyan-600 px-5 py-2 text-sm font-semibold text-white hover:bg-cyan-700 transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
