'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function BalanceSheetError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
        <h2 className="mt-4 text-lg font-bold text-white">
          Balance Sheet Entry Error
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Something went wrong while loading the balance sheet wizard. Your
          entered data may have been preserved in your browser.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Try again
          </button>
          <a
            href="/onboarding"
            className="rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-400"
          >
            Back to Setup
          </a>
        </div>
      </div>
    </div>
  );
}
