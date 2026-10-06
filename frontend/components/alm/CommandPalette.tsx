'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Clock, Play, Search, X, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import {
  ALM_CATEGORIES_BY_ID,
  ALM_MODULES,
  MODULES_BY_SLUG,
  getAlmModuleFromPathname,
  type AlmModule,
} from '@/lib/alm/registry';
import { pushRecent, useRecent } from '@/lib/alm/recent';
import { useActions, type ActionMeta } from '@/hooks/useActions';

// Re-export the test helper from lib/alm/recent so existing tests keep
// importing it from this module without a path change.
export { __resetRecentCacheForTesting } from '@/lib/alm/recent';

/**
 * CommandPalette — Cmd-K / Ctrl-K module jump-to.
 *
 * Mounts globally (typically in app/alm/layout.tsx). Registers a window-
 * level keydown listener that toggles the palette on ⌘K (Mac) or Ctrl+K
 * (Linux/Windows), closes on Escape, navigates on Enter, and supports
 * arrow-key navigation between results.
 *
 * Search scoring walks each module's EN and ES name, description, and
 * category label. The matcher is intentionally cheap — 96 modules × ~3
 * fields fit in a single render cycle with no memoization worries.
 *
 * Accessibility:
 *   - Dialog with aria-modal, role=dialog, labelled by the search input
 *   - Results list is a listbox with aria-activedescendant
 *   - Active result has aria-selected=true
 *   - Escape restores focus to the page
 *   - Focus trap is implicit — the modal covers the viewport and only the
 *     search input is focusable; tab cycles the input only.
 */

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface Scored {
  readonly module: AlmModule;
  readonly score: number;
  readonly matchedField: 'name' | 'description' | 'category' | 'slug' | 'recent';
}

const MAX_RESULTS = 20;

function scoreQuery(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 200;
  if (t.startsWith(q)) return 140;
  if (t.includes(` ${q}`)) return 100; // word-boundary substring
  if (t.includes(q)) return 60;
  // In-order character match
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    ti = t.indexOf(q[qi]!, ti);
    if (ti === -1) return 0;
    ti++;
  }
  return 10;
}

function rankModules(
  query: string,
  locale: 'en' | 'es',
  recent: readonly string[],
): readonly Scored[] {
  if (!query.trim()) {
    // Default view: recent modules first, then GA modules for the rest of
    // the slots. Deduplicate — a recent module shouldn't reappear in the
    // "default" block below it.
    const recentHits: Scored[] = [];
    const seen = new Set<string>();
    for (const slug of recent) {
      const mod = MODULES_BY_SLUG[slug];
      if (mod && !seen.has(slug)) {
        recentHits.push({ module: mod, score: 1000, matchedField: 'recent' });
        seen.add(slug);
      }
    }
    const remaining = ALM_MODULES
      .filter((m) => m.status === 'ga' && !seen.has(m.slug))
      .slice(0, MAX_RESULTS - recentHits.length)
      .map((module) => ({ module, score: 0, matchedField: 'name' as const }));
    return [...recentHits, ...remaining];
  }

  // Suppress unused parameter warning in the fast path — we reference it
  // above but only in the empty-query branch.
  void recent;

  const q = query.trim();
  const results: Scored[] = [];
  for (const mod of ALM_MODULES) {
    const nameScore = Math.max(
      scoreQuery(q, mod.name.en),
      scoreQuery(q, mod.name.es),
    );
    const descScore = Math.max(
      scoreQuery(q, mod.description.en),
      scoreQuery(q, mod.description.es),
    );
    const slugScore = scoreQuery(q, mod.slug);
    const cat = ALM_CATEGORIES_BY_ID[mod.category];
    const catScore = cat ? Math.max(scoreQuery(q, cat.label.en), scoreQuery(q, cat.label.es)) : 0;

    const best = Math.max(nameScore, descScore, slugScore, catScore);
    if (best === 0) continue;

    const matchedField: Scored['matchedField'] =
      best === nameScore ? 'name' :
      best === slugScore ? 'slug' :
      best === descScore ? 'description' :
      'category';

    results.push({ module: mod, score: best, matchedField });
  }

  // Secondary sort by module display name for stable ordering
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.module.name[locale].localeCompare(b.module.name[locale]);
  });

  return results.slice(0, MAX_RESULTS);
}

// ─── Action scoring ─────────────────────────────────────────────────────────

interface ScoredAction {
  readonly action: ActionMeta;
  readonly score: number;
}

function rankActions(query: string, actions: ActionMeta[], locale: 'en' | 'es'): readonly ScoredAction[] {
  if (!query.trim()) {
    return actions.map((action) => ({ action, score: 0 }));
  }
  const results: ScoredAction[] = [];
  for (const action of actions) {
    const labelScore = Math.max(
      scoreQuery(query, action.label.en),
      scoreQuery(query, action.label.es),
    );
    const descScore = action.description
      ? Math.max(scoreQuery(query, action.description.en), scoreQuery(query, action.description.es))
      : 0;
    const idScore = scoreQuery(query, action.id);
    const best = Math.max(labelScore, descScore, idScore);
    if (best > 0) results.push({ action, score: best });
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.action.label[locale].localeCompare(b.action.label[locale]);
  });
  return results.slice(0, 10);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [confirmAction, setConfirmAction] = useState<ActionMeta | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<{ actionId: string; success: boolean; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const { actions, load: loadActions, dispatch: dispatchAction } = useActions();

  // Subscribe to the shared recent-modules store from lib/alm/recent.
  // The hook handles hydration, cross-tab sync, and same-tab updates
  // via useSyncExternalStore under the hood.
  const recent = useRecent();

  // Track navigation — push the current module into the recent cache
  // whenever the pathname resolves to an ALM route. The push goes through
  // an external store, not React state, so this useEffect doesn't call
  // setState directly.
  useEffect(() => {
    const mod = getAlmModuleFromPathname(pathname);
    if (mod) pushRecent(mod.slug);
  }, [pathname]);

  const results = useMemo(() => rankModules(query, locale, recent), [query, locale, recent]);
  const actionResults = useMemo(() => rankActions(query, actions, locale), [query, actions, locale]);
  const totalResults = results.length + actionResults.length;

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    setConfirmAction(null);
    setDispatchResult(null);
  }, []);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isShortcut =
        e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
      if (isShortcut) {
        e.preventDefault();
        if (e.repeat) {
          return;
        }
        setOpen(true);
        void loadActions();
        queueMicrotask(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        if (confirmAction) {
          setConfirmAction(null);
        } else {
          closeAndReset();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeAndReset, loadActions, confirmAction]);

  // Focus the search input each time the palette opens
  useEffect(() => {
    if (open) {
      // Defer to the next tick so the ref is attached
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp active index to valid range on every render — no effect-driven
  // state updates. Arrow keys mutate the raw `activeIndex`; this derives
  // the displayed index and the index used by Enter.
  const safeIndex = Math.min(activeIndex, Math.max(0, totalResults - 1));

  const handleActionDispatch = useCallback(async (action: ActionMeta) => {
    if (action.requiresConfirm) {
      setConfirmAction(action);
      return;
    }
    setDispatching(action.id);
    setDispatchResult(null);
    const result = await dispatchAction(action.id);
    setDispatching(null);
    setDispatchResult({ actionId: action.id, success: result.success, error: result.error });
    if (result.success) {
      setTimeout(closeAndReset, 1200);
    }
  }, [dispatchAction, closeAndReset]);

  const handleConfirmDispatch = useCallback(async () => {
    if (!confirmAction) return;
    setConfirmAction(null);
    setDispatching(confirmAction.id);
    setDispatchResult(null);
    const result = await dispatchAction(confirmAction.id);
    setDispatching(null);
    setDispatchResult({ actionId: confirmAction.id, success: result.success, error: result.error });
    if (result.success) {
      setTimeout(closeAndReset, 1200);
    }
  }, [confirmAction, dispatchAction, closeAndReset]);

  const onQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setActiveIndex(0);
  }, []);

  const onInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, totalResults - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(0, totalResults - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Module results first, then action results
      if (safeIndex < results.length) {
        const picked = results[safeIndex];
        if (!picked) return;
        closeAndReset();
        router.push(picked.module.href);
      } else {
        const actionIdx = safeIndex - results.length;
        const picked = actionResults[actionIdx];
        if (!picked) return;
        void handleActionDispatch(picked.action);
      }
    }
  }, [results, actionResults, totalResults, safeIndex, router, closeAndReset, handleActionDispatch]);

  const openModule = useCallback((href: string) => {
    closeAndReset();
    router.push(href);
  }, [closeAndReset, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); void loadActions(); }}
        className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-300 hover:text-slate-600 lg:inline-flex"
        aria-label={locale === 'es' ? 'Abrir paleta de comandos' : 'Open command palette'}
      >
        <Search className="h-3.5 w-3.5" />
        <span>{locale === 'es' ? 'Buscar…' : 'Search…'}</span>
        <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">⌘K</kbd>
      </button>
    );
  }

  const dialog = (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-slate-950/30 backdrop-blur-sm p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${listboxId}-label`}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAndReset();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.28)]">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={onQueryChange}
            onKeyDown={onInputKeyDown}
            placeholder={locale === 'es' ? 'Buscar módulos y acciones…' : 'Search modules & actions…'}
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={results[safeIndex] ? `${listboxId}-opt-${safeIndex}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">ESC</kbd>
          <button
            type="button"
            onClick={closeAndReset}
            aria-label={locale === 'es' ? 'Cerrar' : 'Close'}
            className="text-slate-400 transition hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hidden label for a11y */}
        <span id={`${listboxId}-label`} className="sr-only">
          {locale === 'es' ? 'Paleta de comandos ALM' : 'ALM Command Palette'}
        </span>

        {/* Results listbox */}
        <div
          id={listboxId}
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {/* Confirmation dialog overlay */}
          {confirmAction && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                <span>{locale === 'es' ? 'Confirmar acción' : 'Confirm action'}</span>
              </div>
              <p className="mt-1 text-xs text-amber-700">
                {confirmAction.description?.[locale] ?? confirmAction.label[locale]}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void handleConfirmDispatch()}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                >
                  {locale === 'es' ? 'Ejecutar' : 'Execute'}
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                >
                  {locale === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </div>
          )}

          {/* Dispatch result feedback */}
          {dispatchResult && (
            <div className={`border-b px-4 py-2 text-xs font-medium ${
              dispatchResult.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}>
              {dispatchResult.success
                ? (locale === 'es' ? 'Acción completada' : 'Action completed')
                : (dispatchResult.error ?? (locale === 'es' ? 'Acción fallida' : 'Action failed'))}
            </div>
          )}

          {totalResults === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              {locale === 'es'
                ? `No se encontraron resultados para "${query}"`
                : `No results found for "${query}"`}
            </div>
          ) : (
            results.map((hit, i) => {
              const { module: mod, matchedField } = hit;
              const Icon = mod.icon;
              const cat = ALM_CATEGORIES_BY_ID[mod.category];
              const active = i === safeIndex;
              const isRecent = matchedField === 'recent';
              // Show a "Recent" section header before the first recent item,
              // and a "Suggested" header before the first non-recent item
              // (only in the default / empty-query view).
              const prevRecent = i > 0 ? results[i - 1]!.matchedField === 'recent' : false;
              const showRecentHeader = query.trim() === '' && isRecent && !prevRecent;
              const showSuggestedHeader = query.trim() === '' && !isRecent && prevRecent;
              return (
                <div key={mod.slug}>
                  {showRecentHeader ? (
                    <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <Clock className="h-2.5 w-2.5" />
                      {locale === 'es' ? 'Recientes' : 'Recent'}
                    </div>
                  ) : null}
                  {showSuggestedHeader ? (
                    <div className="mt-1 border-t border-slate-100 px-4 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {locale === 'es' ? 'Sugeridos' : 'Suggested'}
                    </div>
                  ) : null}
                  <button
                    id={`${listboxId}-opt-${i}`}
                    type="button"
                    onClick={() => openModule(mod.href)}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex items-center gap-3 border-l-2 px-4 py-2.5 transition ${
                      active
                        ? 'border-cyan-500 bg-cyan-50/70'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                      active ? 'border-cyan-200 bg-white text-cyan-700' : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {mod.name[locale]}
                        </p>
                        {mod.status !== 'ga' ? (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200">
                            {mod.status}
                          </span>
                        ) : null}
                        {isRecent ? (
                          <Clock className="h-2.5 w-2.5 text-slate-400" aria-label={locale === 'es' ? 'Reciente' : 'Recent'} />
                        ) : null}
                      </div>
                      <p className="truncate text-[10px] text-slate-400">
                        {cat ? cat.label[locale] : mod.category} · {mod.description[locale]}
                      </p>
                    </div>
                    <kbd className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                      active ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-400'
                    }`}>
                      ↵
                    </kbd>
                  </button>
                </div>
              );
            })
          )}

          {/* Actions section */}
          {actionResults.length > 0 && (
            <>
              <div className="mt-1 border-t border-slate-100 px-4 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Play className="h-2.5 w-2.5" />
                  {locale === 'es' ? 'Acciones' : 'Actions'}
                </div>
              </div>
              {actionResults.map((hit, i) => {
                const globalIdx = results.length + i;
                const active = globalIdx === safeIndex;
                const isDispatching = dispatching === hit.action.id;
                return (
                  <button
                    key={hit.action.id}
                    id={`${listboxId}-opt-${globalIdx}`}
                    type="button"
                    onClick={() => void handleActionDispatch(hit.action)}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    disabled={isDispatching}
                    className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 transition ${
                      active
                        ? 'border-amber-500 bg-amber-50/70'
                        : 'border-transparent hover:bg-slate-50'
                    } disabled:opacity-60`}
                  >
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                      active ? 'border-amber-200 bg-white text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}>
                      <Play className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {hit.action.label[locale]}
                        </p>
                        {hit.action.requiresConfirm && (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200">
                            {locale === 'es' ? 'confirmar' : 'confirm'}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[10px] text-slate-400">
                        {hit.action.module} · {hit.action.description?.[locale] ?? hit.action.id}
                      </p>
                    </div>
                    {isDispatching ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                    ) : (
                      <kbd className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                        active ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                      }`}>
                        ↵
                      </kbd>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[10px] text-slate-500">
          <span>
            {totalResults} {totalResults === 1
              ? (locale === 'es' ? 'resultado' : 'result')
              : (locale === 'es' ? 'resultados' : 'results')}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded bg-white border border-slate-200 px-1 py-0.5 font-mono">↑↓</kbd>
            {locale === 'es' ? 'navegar' : 'navigate'}
            <kbd className="rounded bg-white border border-slate-200 px-1 py-0.5 font-mono">↵</kbd>
            {locale === 'es' ? 'abrir' : 'open'}
          </span>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return dialog;
  }

  return createPortal(dialog, document.body);
}
