'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const PORTAL_WORKSPACE_HREF = '/portal/submit?createCycle=1';

export default function LegacyDashboardUploadRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(PORTAL_WORKSPACE_HREF);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-6 py-10 text-[var(--dashboard-text-primary)]">
      <div className="max-w-lg text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700/80">
          Compatibility Route
        </p>
        <h1 className="mt-4 text-3xl font-semibold">
          Redirecting to the secure reporting workspace
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--dashboard-text-secondary)]">
          CERNIQ now handles upload, validation, and report delivery from the
          portal workspace. This legacy dashboard route remains only as a bridge.
        </p>
        <Link
          href={PORTAL_WORKSPACE_HREF}
          className="mt-8 inline-flex rounded-full bg-[#1B3A6B] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#163258]"
        >
          Open reporting workspace
        </Link>
      </div>
    </div>
  );
}
