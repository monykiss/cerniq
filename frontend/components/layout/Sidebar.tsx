'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';
import { CerniqLockup } from '@/components/brand/CerniqLogo';
import {
  Activity,
  BarChart3,
  Briefcase,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Key,
  Landmark,
  LogOut,
  User,
  X,
  Zap,
} from 'lucide-react';

import {
  ALM_CATEGORIES,
  MODULES_BY_CATEGORY,
} from '@/lib/alm/registry';

interface NavItem {
  href: string;
  icon: React.ElementType;
  labelKey: string;
  children?: NavItem[];
}

const mainNav: NavItem[] = [
  { href: '/dashboard',        icon: BarChart3, labelKey: 'sidebar.dashboard' },
  { href: '/alm',              icon: Activity,  labelKey: 'sidebar.alm' },
  { href: '/portal',           icon: Briefcase, labelKey: 'sidebar.portal' },
];

const settingsNav: NavItem[] = [
  { href: '/onboarding',       icon: User, labelKey: 'sidebar.profile' },
  { href: '/settings/api-keys',icon: Key,  labelKey: 'sidebar.apiKeys' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Sidebar. The ALM module tree is derived from lib/alm/registry.ts — never
 * hardcode module labels or icons in this file. To add or rename a module,
 * edit the registry and this nav updates automatically.
 */
export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuthStore();
  const { t, locale } = useTranslation();
  const [almExpanded, setAlmExpanded] = useState(false);
  const isAlmRoute = pathname.startsWith('/alm');
  const isAlmExpanded = isAlmRoute || almExpanded;

  const isActive = (href: string) => {
    if (href === '/alm' && pathname === '/alm') return true;
    if (href !== '/alm' && pathname.startsWith(href)) return true;
    return pathname === href;
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  // Categories ordered by the canonical registry ordering, skipping any
  // empty buckets. This makes the sidebar panel structurally identical to
  // the /alm/modules index page.
  const populatedCategories = ALM_CATEGORIES.filter(
    (cat) => MODULES_BY_CATEGORY[cat.id].length > 0,
  );

  return (
    <>
      {open ? <div className="fixed inset-0 z-40 bg-slate-950/15 lg:hidden" onClick={onClose} aria-hidden="true" /> : null}

      <aside
        role="navigation"
        aria-label="Main navigation"
        className={`fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r border-[rgba(216,192,139,0.78)] bg-[rgba(255,251,239,0.98)] shadow-[0_24px_80px_rgba(113,88,40,0.12)] backdrop-blur-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:static lg:z-auto lg:translate-x-0`}
      >
        <div className="border-b border-[rgba(216,192,139,0.76)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2" onClick={onClose}>
              <CerniqLockup compact />
            </Link>
            <button
              onClick={onClose}
              className="text-slate-400 transition hover:text-slate-950 lg:hidden"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="rounded-[1.2rem] border border-[rgba(216,192,139,0.78)] bg-gradient-to-br from-[rgba(255,251,239,0.98)] via-[rgba(255,246,230,0.98)] to-[rgba(247,228,188,0.65)] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-800/80">CERNIQ ALM</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">{t('sidebar.description')}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {/* Main nav */}
          <div className="mb-4 px-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {t('sidebar.main')}
            </p>
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group relative mb-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                  isActive(item.href)
                    ? 'border border-cyan-300/90 bg-cyan-50 text-slate-950 shadow-[0_12px_24px_rgba(34,211,238,0.14)]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl border transition ${
                    isActive(item.href)
                      ? 'border-cyan-300 bg-white text-cyan-700'
                      : 'border-slate-200 bg-white text-slate-500 group-hover:border-slate-300 group-hover:text-slate-900'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                {t(item.labelKey)}
                {isActive(item.href) ? <span className="ml-auto h-2 w-2 rounded-full bg-cyan-500" /> : null}
              </Link>
            ))}
          </div>

          {/* ALM tree — derived from the canonical registry. */}
          <div className="mb-4 px-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {t('sidebar.enterprise')}
            </p>
            <div>
              <button
                onClick={() => {
                  if (!isAlmRoute) setAlmExpanded(!almExpanded);
                }}
                aria-expanded={isAlmExpanded}
                aria-controls="alm-module-tree"
                className={`group mb-1 flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition ${
                  isAlmRoute
                    ? 'border border-cyan-300/90 bg-cyan-50 text-slate-950 shadow-[0_12px_24px_rgba(34,211,238,0.14)]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-xl border transition ${
                      isAlmRoute
                        ? 'border-cyan-300 bg-white text-cyan-700'
                        : 'border-slate-200 bg-white text-slate-500 group-hover:border-slate-300 group-hover:text-slate-900'
                    }`}
                  >
                    <Landmark className="h-4 w-4" />
                  </span>
                  {t('sidebar.almIntelligence')}
                </div>
                {isAlmExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>

              {isAlmExpanded ? (
                <div id="alm-module-tree" className="ml-6 border-l border-slate-200 pl-3">
                  {populatedCategories.map((cat) => {
                    const modules = MODULES_BY_CATEGORY[cat.id];
                    return (
                      <div key={cat.id} className="mb-2">
                        <p className="mb-1 mt-2 px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 first:mt-0">
                          {cat.label[locale]}
                        </p>
                        {modules.map((mod) => {
                          const Icon = mod.icon;
                          const active = isActive(mod.href) && (mod.href !== '/alm' || pathname === '/alm');
                          return (
                            <Link
                              key={mod.slug}
                              href={mod.href}
                              onClick={onClose}
                              className={`mb-0.5 flex items-center gap-2 rounded-xl px-2 py-1.5 text-[12px] transition ${
                                active
                                  ? 'bg-cyan-50/80 font-medium text-cyan-800'
                                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                              }`}
                            >
                              <Icon className="h-3 w-3 shrink-0" />
                              <span className="truncate">{mod.name[locale]}</span>
                              {mod.status !== 'ga' ? (
                                <span className="ml-auto rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200">
                                  {mod.status}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* Settings */}
          <div className="px-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {t('sidebar.settings')}
            </p>
            {settingsNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group relative mb-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                  isActive(item.href)
                    ? 'border border-cyan-300/90 bg-cyan-50 text-slate-950 shadow-[0_12px_24px_rgba(34,211,238,0.14)]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl border transition ${
                    isActive(item.href)
                      ? 'border-cyan-300 bg-white text-cyan-700'
                      : 'border-slate-200 bg-white text-slate-500 group-hover:border-slate-300 group-hover:text-slate-900'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                {t(item.labelKey)}
                {isActive(item.href) ? <span className="ml-auto h-2 w-2 rounded-full bg-cyan-500" /> : null}
              </Link>
            ))}
          </div>
        </nav>

        <div className="border-t border-[rgba(216,192,139,0.76)] p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-cyan-50 hover:text-cyan-800"
          >
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </button>
        </div>
      </aside>
    </>
  );
}
