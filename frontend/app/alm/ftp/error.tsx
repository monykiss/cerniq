'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function ALMModuleError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h2 className="text-lg font-bold text-slate-950">Module Error</h2>
      <p className="text-sm text-slate-500 max-w-md text-center">
        This ALM module encountered an error. Your data is safe.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800"
      >
        Retry
      </button>
    </div>
  );
}
