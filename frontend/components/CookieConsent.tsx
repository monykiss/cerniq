'use client';

import { useState, useEffect } from 'react';
import { PUBLIC_PATHS } from '@/lib/public-links';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const consent = localStorage.getItem('cerniq_cookie_consent');
      if (!consent) {
        setVisible(true);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  function accept() {
    localStorage.setItem('cerniq_cookie_consent', 'accepted');
    setVisible(false);
  }

  function decline() {
    localStorage.setItem('cerniq_cookie_consent', 'declined');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[9999] p-4 sm:p-6" role="dialog" aria-label="Cookie consent">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-xs text-slate-600 flex-1">
          We use essential cookies for authentication and analytics cookies to improve our platform.
          See our <a href={PUBLIC_PATHS.privacy} className="text-cyan-700 underline">Privacy Policy</a> for details.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={decline} className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
            Decline
          </button>
          <button onClick={accept} className="rounded-lg bg-cyan-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-cyan-800 transition">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
