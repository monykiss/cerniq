'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Landmark } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { getAlmModuleFromPathname, getModuleName } from '@/lib/alm/registry';

/**
 * ALM breadcrumb. Reads module labels from the canonical registry at
 * lib/alm/registry.ts — never hardcode slug→label maps in this file.
 *
 * If the route's slug isn't registered, the breadcrumb hides itself rather
 * than rendering a raw slug. The CI guard at scripts/verify-alm-registry.mjs
 * fails the build if any app/alm/<slug>/ folder lacks a registry entry, so
 * this branch should be unreachable in CI-passing builds.
 */
export default function ALMBreadcrumb() {
  const pathname = usePathname();
  const { locale } = useTranslation();

  if (!pathname.startsWith('/alm/')) return null;

  const mod = getAlmModuleFromPathname(pathname);
  if (!mod) return null;

  const displayName = getModuleName(mod.slug, locale, { short: true }) ?? mod.name[locale];

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 px-6 py-2 text-[11px] text-slate-400 border-b border-slate-100"
    >
      <Link href="/alm" className="flex items-center gap-1 hover:text-cyan-700 transition">
        <Landmark className="h-3 w-3" />
        <span>ALM</span>
      </Link>
      <ChevronRight className="h-3 w-3" />
      <span className="text-slate-700 font-medium">{displayName}</span>
    </nav>
  );
}
