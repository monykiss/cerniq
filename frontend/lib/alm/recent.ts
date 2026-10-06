/**
 * Recent ALM modules — shared external store.
 *
 * A small module-level cache that tracks the last N modules the user
 * visited. Consumed by CommandPalette, the /alm landing page, and any
 * future feature that wants to surface "jump back in" content.
 *
 * Persistence: localStorage under `cerniq.alm.recent.v1`.
 * Cross-tab sync: native `storage` event.
 * Same-tab sync: custom `cerniq:recent-change` event.
 * SSR: `loadRecent` and `getRecentSnapshot` return a frozen empty array
 * when `window` is undefined, so `useSyncExternalStore` gets a stable
 * server snapshot and the app never throws during hydration.
 *
 * Design constraints:
 *   1. The module-level cache holds a *stable reference* so
 *      useSyncExternalStore's shallow-equality contract is satisfied.
 *      A fresh `loadRecent()` call returns either the cached reference
 *      or a brand-new frozen array.
 *   2. Writes go through `pushRecent(slug)` which dedupes, caps at
 *      RECENT_MAX, and dispatches the change event. No one else should
 *      mutate `recentCache` directly.
 *   3. `__resetRecentCacheForTesting()` is the only way to clear the
 *      module-level state — call it in test beforeEach hooks.
 */

import { useSyncExternalStore } from 'react';

const RECENT_STORAGE_SLOT = 'cerniq.alm.recent.v1';
const RECENT_EVENT = 'cerniq:recent-change';
export const RECENT_MAX = 5;

const EMPTY_RECENT: readonly string[] = Object.freeze([]);

let recentCache: readonly string[] = EMPTY_RECENT;
let initializedFromStorage = false;

// ─── Reads ──────────────────────────────────────────────────────────────────

export function loadRecent(): readonly string[] {
  if (typeof window === 'undefined') return EMPTY_RECENT;
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_SLOT);
    if (!raw) return EMPTY_RECENT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_RECENT;
    const slugs = parsed.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX);
    return slugs.length === 0 ? EMPTY_RECENT : Object.freeze(slugs);
  } catch {
    return EMPTY_RECENT;
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

function saveRecent(slugs: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_STORAGE_SLOT, JSON.stringify(slugs.slice(0, RECENT_MAX)));
  } catch {
    // Storage blocked — silently ignore; recent list just won't persist.
  }
}

/**
 * Bump a module to the front of the recent list. Mutates the cache and
 * broadcasts to any listening subscribers. Safe to call repeatedly —
 * if the slug is already at the head, this is a no-op.
 */
export function pushRecent(slug: string): void {
  if (typeof window === 'undefined') return;
  if (!initializedFromStorage) {
    recentCache = loadRecent();
    initializedFromStorage = true;
  }
  if (recentCache[0] === slug) return;
  const next = Object.freeze([slug, ...recentCache.filter((s) => s !== slug)].slice(0, RECENT_MAX));
  recentCache = next;
  saveRecent(next);
  window.dispatchEvent(new Event(RECENT_EVENT));
}

/**
 * Clear the recent list. Persists the empty state and broadcasts so all
 * subscribers re-render.
 */
export function clearRecent(): void {
  if (typeof window === 'undefined') return;
  recentCache = EMPTY_RECENT;
  saveRecent(EMPTY_RECENT);
  initializedFromStorage = true;
  window.dispatchEvent(new Event(RECENT_EVENT));
}

// ─── useSyncExternalStore bindings ─────────────────────────────────────────

export function subscribeRecent(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handle = (e: Event) => {
    if (e.type === 'storage') {
      const se = e as StorageEvent;
      if (se.key !== RECENT_STORAGE_SLOT) return;
      recentCache = loadRecent();
    }
    onStoreChange();
  };
  window.addEventListener(RECENT_EVENT, handle);
  window.addEventListener('storage', handle);
  return () => {
    window.removeEventListener(RECENT_EVENT, handle);
    window.removeEventListener('storage', handle);
  };
}

export function getRecentSnapshot(): readonly string[] {
  if (typeof window === 'undefined') return EMPTY_RECENT;
  if (!initializedFromStorage) {
    recentCache = loadRecent();
    initializedFromStorage = true;
  }
  return recentCache;
}

export function getRecentServerSnapshot(): readonly string[] {
  return EMPTY_RECENT;
}

// ─── React hook ─────────────────────────────────────────────────────────────

/**
 * React hook — subscribes to the recent-modules store and re-renders
 * whenever the list changes (same-tab or cross-tab). SSR-safe.
 *
 *   const recent = useRecent();  // readonly string[] of up to RECENT_MAX slugs
 */
export function useRecent(): readonly string[] {
  return useSyncExternalStore(subscribeRecent, getRecentSnapshot, getRecentServerSnapshot);
}

// ─── Testing ────────────────────────────────────────────────────────────────

/**
 * Test-only: clears the module-level cache and forces the next
 * `getRecentSnapshot()` call to re-read from localStorage. Call this in
 * your test's `beforeEach` to isolate state between tests.
 */
export function __resetRecentCacheForTesting(): void {
  recentCache = EMPTY_RECENT;
  initializedFromStorage = false;
}
