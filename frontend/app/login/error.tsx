'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function LoginError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
        <h2 className="mt-4 text-lg font-bold text-white">Login Error</h2>
        <p className="mt-2 text-sm text-slate-400">
          Unable to load the login page. Please try again.
        </p>
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
