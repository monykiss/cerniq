'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { Search } from 'lucide-react';
import {
  ALM_CATEGORIES,
  MODULES_BY_CATEGORY,
  ALM_MODULE_COUNT,
} from '@/lib/alm/registry';

/**
 * ALM Module Index — derived view of the canonical registry.
 *
 * The 8-category grid is computed from MODULES_BY_CATEGORY, which is itself
 * derived from ALM_MODULES at module load time. To add or rename a module,
 * edit lib/alm/registry.ts — never edit this file directly.
 */
export default function ModuleIndexPage() {
  const { locale } = useTranslation();
  const en = locale === 'en';

  // Count modules that have at least one entry, suppress empty categories.
  const populatedCategories = ALM_CATEGORIES.filter(
    (cat) => MODULES_BY_CATEGORY[cat.id].length > 0,
  );

  const frontierCount = MODULES_BY_CATEGORY.frontier.length;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600">
            <Search className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-950">
              {en ? 'ALM Module Index' : 'Índice de Módulos ALM'}
            </h1>
            <p className="text-xs text-slate-500">
              {en ? 'Every analytical capability in one view' : 'Todas las capacidades analíticas en una vista'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-slate-950 tabular-nums">{ALM_MODULE_COUNT}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {en ? 'Modules' : 'Módulos'}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <p className="text-2xl font-bold text-slate-950 tabular-nums">{populatedCategories.length}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {en ? 'Domains' : 'Dominios'}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <p className="text-2xl font-bold text-slate-950 tabular-nums">{frontierCount}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {en ? 'Quant Frontier' : 'Frontera Quant'}
            </p>
          </div>
        </div>
      </div>

      {/* Category Sections */}
      {populatedCategories.map((cat) => {
        const modules = MODULES_BY_CATEGORY[cat.id];
        return (
          <section key={cat.id}>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: `var(--color-${cat.color}-500, #06b6d4)` }}
                aria-hidden
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {cat.label[locale]} <span className="text-slate-300">({modules.length})</span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <Link
                    key={mod.slug}
                    href={mod.href}
                    className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:shadow-sm"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 group-hover:border-slate-200">
                      <Icon className="h-4 w-4 text-slate-500 group-hover:text-slate-700" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-slate-800 group-hover:text-slate-950 truncate">
                          {mod.name[locale]}
                        </p>
                        {mod.status !== 'ga' ? (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200">
                            {mod.status}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5 line-clamp-2">
                        {mod.description[locale]}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
