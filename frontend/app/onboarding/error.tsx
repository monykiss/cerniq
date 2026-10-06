'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle } from 'lucide-react';

export default function OnboardingError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
        <h2 className="mt-4 text-lg font-bold text-white">Onboarding Error</h2>
        <p className="mt-2 text-sm text-slate-400">
          Something went wrong during setup. Your progress has been saved.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-400"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
