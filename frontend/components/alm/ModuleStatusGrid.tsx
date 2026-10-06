import Link from 'next/link';
import { Check } from 'lucide-react';

import type { Locale } from '@/lib/i18n';
import {
  ALM_CATEGORIES,
  MODULES_BY_CATEGORY,
  isMigrated,
  type AlmCategoryId,
  type AlmModule,
} from '@/lib/alm/registry';

/**
 * ModuleStatusGrid — registry-driven catalog of every ALM module.
 *
 * Replaces the hand-maintained `<ModuleCard>` lists that used to live in
 * the landing page and elsewhere. Every entry derives from ALM_MODULES so
 * adding a new module is a single edit to the registry.
 *
 * Server-component-compatible (no hooks). Accepts a filter prop to show
 * only migrated / unmigrated / all modules.
 *
 * Layout: one labeled section per populated category, each containing a
 * responsive grid of dense module cards. Migrated modules get a small
 * green check icon; unmigrated modules are visually muted (opacity-60)
 * and get a "soon" badge.
 */

export interface ModuleStatusGridProps {
  readonly locale: Locale;
  /** 'all' = every module, 'migrated' = only shell-ready, 'pending' = not-yet-migrated */
  readonly filter?: 'all' | 'migrated' | 'pending';
  /** Only render these category IDs (default: all populated) */
  readonly categories?: readonly AlmCategoryId[];
  /** Hide the category section headers (useful in constrained layouts) */
  readonly hideCategoryHeaders?: boolean;
  /** Compact mode — smaller card padding and icon size */
  readonly compact?: boolean;
  readonly className?: string;
}

interface ModuleCardProps {
  readonly mod: AlmModule;
  readonly locale: Locale;
  readonly migrated: boolean;
  readonly compact: boolean;
}

function ModuleCard({ mod, locale, migrated, compact }: ModuleCardProps) {
  const Icon = mod.icon;
  const iconClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const titleClass = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <Link
      href={mod.href}
      className={`group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition hover:border-slate-200 hover:bg-slate-50 ${migrated ? '' : 'opacity-60'}`}
    >
      <Icon className={`${iconClass} shrink-0 text-slate-400 group-hover:text-slate-600`} />
      <p className={`truncate ${titleClass} font-medium text-slate-700 group-hover:text-slate-900`}>
        {mod.name[locale]}
      </p>
      {migrated ? (
        <Check className="h-2.5 w-2.5 shrink-0 text-emerald-500" aria-label={locale === 'es' ? 'Listo' : 'Ready'} />
      ) : null}
      {mod.status !== 'ga' ? (
        <span className="ml-auto shrink-0 rounded px-1 py-px text-[7px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200">
          {mod.status}
        </span>
      ) : null}
    </Link>
  );
}

export function ModuleStatusGrid({
  locale,
  filter = 'all',
  categories,
  hideCategoryHeaders = false,
  compact = false,
  className,
}: ModuleStatusGridProps) {
  const effectiveCategories = (categories ?? ALM_CATEGORIES.map((c) => c.id));

  const filteredByCategory = effectiveCategories
    .map((catId) => {
      const allModules = MODULES_BY_CATEGORY[catId];
      const mods = allModules.filter((m) => {
        if (filter === 'all')      return true;
        if (filter === 'migrated') return isMigrated(m.slug);
        return !isMigrated(m.slug);
      });
      return { catId, modules: mods };
    })
    .filter((c) => c.modules.length > 0);

  if (filteredByCategory.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white py-12 text-center text-xs text-slate-400 ${className ?? ''}`}>
        {locale === 'es' ? 'Sin módulos que mostrar' : 'No modules to display'}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${className ?? ''}`}>
      {filteredByCategory.map(({ catId, modules }) => {
        const cat = ALM_CATEGORIES.find((c) => c.id === catId);
        if (!cat) return null;
        const migratedInCat = modules.filter((m) => isMigrated(m.slug)).length;
        return (
          <section key={catId}>
            {hideCategoryHeaders ? null : (
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {cat.label[locale]}
                </p>
                <span className="text-[9px] text-slate-300">
                  {migratedInCat}/{modules.length}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {modules.map((mod) => (
                <ModuleCard
                  key={mod.slug}
                  mod={mod}
                  locale={locale}
                  migrated={isMigrated(mod.slug)}
                  compact={compact}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
