'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { hasStoredAdminKey } from '@/lib/admin-session';

const NAV_ITEMS = [
  ['Admin', '/admin'],
  ['Pipeline', '/admin/pipeline'],
  ['Ops', '/admin/ops'],
  ['Audit', '/admin/audit'],
  ['Governance', '/admin/governance'],
  ['Models', '/admin/models'],
];

export default function AdminSessionBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const hasAdminKey = hasStoredAdminKey();
  const isAdminHome = pathname === '/admin';

  useEffect(() => {
    if (!hasAdminKey && !isAdminHome) {
      router.replace('/admin');
    }
  }, [hasAdminKey, isAdminHome, router]);

  if (!hasAdminKey && !isAdminHome) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/80 px-5 py-4 text-sm text-slate-300">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-300/20 border-t-cyan-300" />
          Redirecting to admin access...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {hasAdminKey ? (
        <div className="border-b border-white/10 bg-slate-900/60 px-6 py-3">
          <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto">
            {NAV_ITEMS.map(([label, href]) => {
              const active =
                pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-200'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
