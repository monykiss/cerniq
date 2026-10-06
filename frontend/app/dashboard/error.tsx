'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Dashboard error', error);
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h2 className="text-lg font-bold text-slate-950">Dashboard Error</h2>
      <p className="text-sm text-slate-500 max-w-md text-center">
        Something went wrong loading your dashboard. Your data is safe.
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
