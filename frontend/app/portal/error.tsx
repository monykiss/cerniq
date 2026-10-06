'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function PortalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h2 className="text-lg font-bold text-slate-950">Portal Error</h2>
      <p className="text-sm text-slate-500 max-w-md text-center">
        Something went wrong loading your portal. Your reports and data are safe.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800"
        >
          Retry
        </button>
        <a
          href="/portal"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400"
        >
          Back to Portal
        </a>
      </div>
    </div>
  );
}
