'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { useAuthStore } from '@/lib/store';
import { Clock } from 'lucide-react';

interface Props {
  enabled?: boolean;
  timeoutMinutes?: number;
}

export default function SessionTimeoutWarning({ enabled = true, timeoutMinutes = 30 }: Props) {
  const [warningAuthRevision, setWarningAuthRevision] = useState<number | null>(null);
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authRevision = useAuthStore((state) => state.authRevision);
  const sessionTimeoutEnabled = enabled && isAuthenticated;

  const handleTimeout = useCallback(() => {
    // Clear session and redirect to login
    setWarningAuthRevision(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('cerniq_access_token');
      localStorage.removeItem('cerniq_access_token');
    }
    router.push('/login?reason=timeout');
  }, [router]);

  const handleWarning = useCallback(() => {
    if (sessionTimeoutEnabled) {
      setWarningAuthRevision(authRevision);
    }
  }, [authRevision, sessionTimeoutEnabled]);

  const { resetTimers } = useSessionTimeout({
    timeoutMs: timeoutMinutes * 60 * 1000,
    warningMs: 5 * 60 * 1000,
    onTimeout: handleTimeout,
    onWarning: handleWarning,
    enabled: sessionTimeoutEnabled,
  });

  const shouldShowWarning = sessionTimeoutEnabled && warningAuthRevision === authRevision;

  if (!shouldShowWarning) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm" role="alertdialog" aria-label="Session timeout warning">
      <div className="mx-4 max-w-sm rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-950">Session Expiring</h2>
            <p className="text-xs text-slate-500">Your session will end in 5 minutes</p>
          </div>
        </div>
        <p className="text-xs text-slate-600 mb-5 leading-relaxed">
          For the security of your institution&apos;s data, inactive sessions are automatically ended after {timeoutMinutes} minutes.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { setWarningAuthRevision(null); resetTimers(); }}
            className="flex-1 rounded-xl bg-cyan-700 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 transition"
          >
            Continue Working
          </button>
          <button
            onClick={handleTimeout}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
