'use client';

import type { ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n';
import {
  getAlmModule,
  type AlmCategoryId,
  type AlmModuleSlug,
} from '@/lib/alm/registry';

export type AlmIconTint =
  | 'slate'
  | 'cyan'
  | 'purple'
  | 'rose'
  | 'emerald'
  | 'amber'
  | 'indigo'
  | 'sky'
  | 'blue'
  | 'violet'
  | 'red';

const ICON_TINT_CLASSES: Record<AlmIconTint, { border: string; bg: string; text: string }> = {
  slate: { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-700' },
  cyan: { border: 'border-cyan-200', bg: 'bg-cyan-50', text: 'text-cyan-700' },
  purple: { border: 'border-purple-200', bg: 'bg-purple-50', text: 'text-purple-700' },
  rose: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-700' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700' },
  indigo: { border: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  sky: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-700' },
  blue: { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-700' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-700' },
  red: { border: 'border-red-200', bg: 'bg-red-50', text: 'text-red-700' },
};

const DEFAULT_TINT_BY_CATEGORY: Readonly<Record<AlmCategoryId, AlmIconTint>> = {
  core: 'indigo',
  rate: 'cyan',
  liquidity: 'emerald',
  credit: 'rose',
  quant: 'purple',
  strategy: 'blue',
  regulatory: 'amber',
  intelligence: 'slate',
  frontier: 'violet',
};

export interface AlmModuleHeaderProps {
  readonly slug: AlmModuleSlug;
  readonly controls?: ReactNode;
  readonly iconTint?: AlmIconTint;
}

export function getDefaultAlmIconTint(category: AlmCategoryId): AlmIconTint {
  return DEFAULT_TINT_BY_CATEGORY[category];
}

export function AlmModuleHeader({
  slug,
  controls,
  iconTint,
}: AlmModuleHeaderProps) {
  const { locale } = useTranslation();
  const mod = getAlmModule(slug);

  if (!mod) {
    return null;
  }

  const ModuleIcon = mod.icon;
  const tint = ICON_TINT_CLASSES[iconTint ?? getDefaultAlmIconTint(mod.category)];

  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${tint.border} ${tint.bg}`}>
          <ModuleIcon className={`h-4 w-4 ${tint.text}`} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-lg font-bold text-slate-950">{mod.name[locale]}</h1>
            {mod.status !== 'ga' ? (
              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-amber-700">
                {mod.status}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">{mod.description[locale]}</p>
        </div>
      </div>
      {controls ? <div className="flex items-center gap-2">{controls}</div> : null}
    </header>
  );
}
