'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import ALMProvider, { useALM } from '@/components/alm/ALMProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Menu, Building2, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import ALMBreadcrumb from '@/components/alm/ALMBreadcrumb';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';
import { CommandPalette } from '@/components/alm/CommandPalette';
import { AlmModuleHeader } from '@/components/alm/AlmModuleHeader';
import { getAlmModuleFromPathname, AUTO_SHELL_SLUGS } from '@/lib/alm/registry';
import { looksLikeLegacyModuleHeader } from '@/lib/alm/legacy-header';

function LanguageToggle() {
  const { locale, setLocale } = useTranslation();
  return (
    <div className="cerniq-dashboard-elevated-surface flex items-center gap-0.5 rounded-full p-1 shadow-sm">
      <button
        onClick={() => setLocale('en')}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${locale === 'en' ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 hover:text-slate-950'
          }`}
        aria-label="Switch to English" aria-pressed={locale === 'en'}
      >
        EN
      </button>
      <button
        onClick={() => setLocale('es')}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${locale === 'es' ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 hover:text-slate-950'
          }`}
        aria-label="Cambiar a Espanol" aria-pressed={locale === 'es'}
      >
        ES
      </button>
    </div>
  );
}

function ALMTopBar() {
  const { institutions, selectedId, institution, setSelectedId } = useALM();
  const { t } = useTranslation();

  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {institution && (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50">
              <Building2 className="h-4 w-4 text-cyan-700" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-tight text-slate-950">{institution.name}</p>
              <p className="text-[11px] capitalize text-slate-500">{institution.type.replace('_', ' ')}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {institutions.length > 1 && (
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="cerniq-field cerniq-select cursor-pointer py-2 pl-3 pr-8 text-xs"
            >
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          </div>
        )}
        <CommandPalette />
        <LanguageToggle />
        <Link
          href="/pricing"
          className="hidden text-[11px] text-slate-500 transition hover:text-cyan-700 sm:inline"
        >
          {t('alm.pricing')}
        </Link>
        {selectedId && (
          <DocumentExportButtons
            manifestPath={`/api/alm/${selectedId}/exports`}
            kinds={['alm_report']}
            compact
          />
        )}
      </div>
    </div>
  );
}

function DemoBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-cyan-100 bg-cyan-50/70 px-6 py-2">
      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
      <p className="text-[11px] font-medium uppercase tracking-wide text-cyan-800/80">
        {t('alm.demoBanner')}
      </p>
    </div>
  );
}

function MobileHeader({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { institution } = useALM();
  const { t } = useTranslation();
  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 lg:hidden">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="rounded-xl p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-slate-950">{t('alm.almIntelligence')}</span>
      </div>
      {institution && (
        <span className="max-w-[140px] truncate text-[11px] text-slate-500">{institution.name}</span>
      )}
    </div>
  );
}

function ALMRedirectingState() {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-6 py-10">
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50">
          <RefreshCw className="h-6 w-6 animate-spin text-cyan-700" />
        </div>
        <h2 className="text-lg font-semibold text-slate-950">Redirecting to sign in</h2>
        <p className="mt-2 text-sm text-slate-600">
          ALM requires an authenticated session. We are sending you to the login screen now.
        </p>
      </div>
    </div>
  );
}

function ALMServiceError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-6 py-10">
      <div className="max-w-xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50">
          <Building2 className="h-6 w-6 text-rose-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-950">ALM data service unavailable</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => void onRetry()}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
          <span className="text-xs text-slate-500">Check that the CERNIQ backend is running on port 3000.</span>
        </div>
      </div>
    </div>
  );
}

function ALMShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { authRedirecting, bootstrapError, refresh } = useALM();
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const autoShellModule = pathname ? getAlmModuleFromPathname(pathname) : undefined;
  const shouldAutoShell = !!(autoShellModule && AUTO_SHELL_SLUGS.has(autoShellModule.slug));

  useEffect(() => {
    const host = contentRef.current;
    if (!host || !shouldAutoShell) {
      return;
    }

    const pageRoot = host.firstElementChild;
    if (!(pageRoot instanceof HTMLElement)) {
      return;
    }

    const legacyHeader = pageRoot.firstElementChild;
    if (!(legacyHeader instanceof HTMLElement) || !looksLikeLegacyModuleHeader(legacyHeader)) {
      return;
    }

    const previousHidden = legacyHeader.hasAttribute('hidden');
    legacyHeader.setAttribute('hidden', '');

    return () => {
      if (!previousHidden) {
        legacyHeader.removeAttribute('hidden');
      }
    };
  }, [pathname, shouldAutoShell, children]);

  return (
    <div className="cerniq-dashboard-theme flex h-screen overflow-hidden bg-[var(--dashboard-base)] text-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHeader onOpenSidebar={() => setSidebarOpen(true)} />

        <DemoBanner />
        <ALMTopBar />
        <ALMBreadcrumb />

        <main id="alm-report-content" className="flex-1 overflow-y-auto bg-transparent scroll-smooth">
          {authRedirecting ? (
            <ALMRedirectingState />
          ) : bootstrapError ? (
            <ALMServiceError message={bootstrapError} onRetry={refresh} />
          ) : (
            <div className="animate-fade-in">
              {shouldAutoShell && autoShellModule ? (
                <div className="p-6 pb-0 max-w-[1400px] mx-auto">
                  <AlmModuleHeader slug={autoShellModule.slug} />
                </div>
              ) : null}
              <div ref={contentRef}>
                {children}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ALMLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div className="cerniq-dashboard-theme cerniq-dashboard-page flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
            <p className="text-sm text-slate-500">{t('alm.loadingAlm')}</p>
          </div>
        </div>
      }
    >
      <ALMProvider>
        <ALMShell>
          <ErrorBoundary context="alm">
            {children}
          </ErrorBoundary>
        </ALMShell>
      </ALMProvider>
    </Suspense>
  );
}
