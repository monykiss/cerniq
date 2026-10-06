'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Clock, ArrowRight } from 'lucide-react';
import { getPublicApiUrl } from '@/lib/api-base';
import { analytics, EVENTS } from '@/lib/analytics';
import {
  buildLoginUrlForReturnUrl,
  sanitizePostAuthReturnUrl,
} from '@/lib/auth-redirect';

function VerifyInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'verifying' | 'error'>('verifying');
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const returnUrl = sanitizePostAuthReturnUrl(searchParams.get('returnUrl'));

  useEffect(() => {
    if (!token || !email) {
      return;
    }

    analytics.track(EVENTS.MAGIC_LINK_CLICKED);

    const verifyUrl = getPublicApiUrl(
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&returnUrl=${encodeURIComponent(returnUrl)}`,
    );

    fetch(verifyUrl, {
      credentials: 'include',
      redirect: 'follow',
    })
      .then((res) => {
        if (res.redirected) {
          // Server resolved the auth flow — follow the requested destination.
          window.location.href = res.url;
          return;
        }
        if (!res.ok) {
          setStatus('error');
          return;
        }
        // Fallback: if somehow we got a 200 JSON response, keep moving to the requested destination.
        router.push(returnUrl);
      })
      .catch(() => {
        setStatus('error');
      });
  }, [email, returnUrl, router, token]);

  if (!token || !email || status === 'error') {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#1B3A6B]">
          <span className="text-lg font-bold text-white">C</span>
        </div>

        <div className="cerniq-dashboard-elevated-surface rounded-xl border p-6">
          <Clock className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h1 className="mb-2 text-lg font-semibold text-gray-900">
            Link Expired or Already Used
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            This login link has expired or has already been used. Login links
            are valid for 1 hour and can only be used once.
          </p>
          <Link
            href={buildLoginUrlForReturnUrl(returnUrl, {
              forceMagicLink: true,
            })}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1B3A6B] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#15305a]"
          >
            Request New Link <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1B3A6B] border-t-transparent" />
      <span className="text-sm text-gray-500">
        Verifying your login link...
      </span>
    </div>
  );
}

export default function MagicLinkVerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent p-4">
      <Suspense
        fallback={
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1B3A6B] border-t-transparent" />
            <span className="text-sm text-gray-500">Loading...</span>
          </div>
        }
      >
        <VerifyInner />
      </Suspense>
    </div>
  );
}
