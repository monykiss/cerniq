'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-lg font-bold text-slate-950">Something went wrong</h2>
      <button onClick={reset} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800">Try again</button>
    </div>
  );
}
