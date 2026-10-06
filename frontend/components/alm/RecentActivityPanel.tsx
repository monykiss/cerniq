'use client';

import Link from 'next/link';
import { Clock, ChevronRight, Search } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { useRecent } from '@/lib/alm/recent';
import { MODULES_BY_SLUG } from '@/lib/alm/registry';

/**
 * RecentActivityPanel — "jump back in" list for the ALM landing page.
 *
 * Subscribes to the same recent-modules store as the Cmd-K palette (via
 * useRecent()), so anything the user visits — whether through the palette,
 * the sidebar, the browser URL bar, or this panel itself — bumps the
 * module to the front of the list immediately.
 *
 * Empty state pitches Cmd-K as the discovery mechanism.
 */

export interface RecentActivityPanelProps {
  readonly className?: string;
  readonly max?: number;
}

export function RecentActivityPanel({ className, max = 5 }: RecentActivityPanelProps) {
  const { locale } = useTranslation();
  const recent = useRecent();

  const items = recent
    .slice(0, max)
    .map((slug) => MODULES_BY_SLUG[slug])
    .filter((mod): mod is NonNullable<typeof mod> => mod != null);

  if (items.length === 0) {
    return (
      <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className ?? ''}`}>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Actividad Reciente' : 'Recent Activity'}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-[11px] text-slate-500">
            {locale === 'es'
              ? 'No hay actividad reciente.'
              : 'No recent activity yet.'}
          </p>
          <p className="text-[10px] text-slate-400">
            {locale === 'es' ? 'Presione' : 'Press'}{' '}
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] text-slate-600">⌘K</kbd>{' '}
            {locale === 'es' ? 'para buscar cualquier módulo' : 'to search any module'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Actividad Reciente' : 'Recent Activity'}
        </p>
        <span className="text-[9px] text-slate-300">{items.length}</span>
      </div>
      <div className="space-y-1">
        {items.map((mod, i) => {
          const Icon = mod.icon;
          return (
            <Link
              key={mod.slug}
              href={mod.href}
              className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-slate-200 hover:bg-slate-50"
            >
              <span className="font-mono text-[9px] text-slate-300 w-3 text-right">{i + 1}</span>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 group-hover:border-slate-200">
                <Icon className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-700" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800 group-hover:text-slate-950">
                  {mod.name[locale]}
                </p>
                <p className="truncate text-[10px] text-slate-400">{mod.description[locale]}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
