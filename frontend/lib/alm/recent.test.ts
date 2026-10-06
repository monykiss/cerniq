/**
 * Tests for lib/alm/recent — the shared recent-modules external store.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  loadRecent,
  pushRecent,
  clearRecent,
  getRecentSnapshot,
  getRecentServerSnapshot,
  subscribeRecent,
  __resetRecentCacheForTesting,
  RECENT_MAX,
} from './recent';

const STORAGE_SLOT = 'cerniq.alm.recent.v1';

beforeEach(() => {
  // Fresh store + fresh localStorage each test
  try {
    window.localStorage.removeItem(STORAGE_SLOT);
  } catch {
    // ignore
  }
  __resetRecentCacheForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── loadRecent ─────────────────────────────────────────────────────────────

describe('loadRecent', () => {
  it('returns empty for uninitialized localStorage', () => {
    expect(loadRecent()).toEqual([]);
  });

  it('reads a valid array of slugs', () => {
    window.localStorage.setItem(STORAGE_SLOT, JSON.stringify(['var', 'cecl']));
    expect(loadRecent()).toEqual(['var', 'cecl']);
  });

  it('filters non-string entries', () => {
    window.localStorage.setItem(STORAGE_SLOT, JSON.stringify(['var', 42, null, 'cecl']));
    expect(loadRecent()).toEqual(['var', 'cecl']);
  });

  it('caps at RECENT_MAX entries', () => {
    const many = Array.from({ length: RECENT_MAX + 5 }, (_, i) => `slug-${i}`);
    window.localStorage.setItem(STORAGE_SLOT, JSON.stringify(many));
    expect(loadRecent()).toHaveLength(RECENT_MAX);
  });

  it('returns empty on corrupt JSON', () => {
    window.localStorage.setItem(STORAGE_SLOT, 'not valid json');
    expect(loadRecent()).toEqual([]);
  });

  it('returns empty when the stored value is not an array', () => {
    window.localStorage.setItem(STORAGE_SLOT, JSON.stringify({ foo: 'bar' }));
    expect(loadRecent()).toEqual([]);
  });

  it('returns a frozen array', () => {
    window.localStorage.setItem(STORAGE_SLOT, JSON.stringify(['var']));
    const result = loadRecent();
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ─── pushRecent ─────────────────────────────────────────────────────────────

describe('pushRecent', () => {
  it('puts a new slug at the front', () => {
    pushRecent('var');
    expect(getRecentSnapshot()).toEqual(['var']);
  });

  it('deduplicates — the same slug only appears once', () => {
    pushRecent('var');
    pushRecent('cecl');
    pushRecent('var');
    expect(getRecentSnapshot()).toEqual(['var', 'cecl']);
  });

  it('caps at RECENT_MAX', () => {
    for (let i = 0; i < RECENT_MAX + 3; i++) pushRecent(`slug-${i}`);
    expect(getRecentSnapshot()).toHaveLength(RECENT_MAX);
  });

  it('is a no-op when the slug is already at head', () => {
    pushRecent('var');
    const before = getRecentSnapshot();
    pushRecent('var');
    const after = getRecentSnapshot();
    // Reference equality — no new array allocated
    expect(after).toBe(before);
  });

  it('persists the new list to localStorage', () => {
    pushRecent('var');
    pushRecent('cecl');
    const raw = window.localStorage.getItem(STORAGE_SLOT);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(['cecl', 'var']);
  });

  it('dispatches the cerniq:recent-change event', () => {
    const listener = vi.fn();
    window.addEventListener('cerniq:recent-change', listener);
    pushRecent('var');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('cerniq:recent-change', listener);
  });
});

// ─── clearRecent ────────────────────────────────────────────────────────────

describe('clearRecent', () => {
  it('empties the cache', () => {
    pushRecent('var');
    pushRecent('cecl');
    clearRecent();
    expect(getRecentSnapshot()).toEqual([]);
  });

  it('persists the empty state to localStorage', () => {
    pushRecent('var');
    clearRecent();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_SLOT)!)).toEqual([]);
  });
});

// ─── snapshots ──────────────────────────────────────────────────────────────

describe('getRecentSnapshot', () => {
  it('returns a stable reference between calls', () => {
    pushRecent('var');
    const a = getRecentSnapshot();
    const b = getRecentSnapshot();
    expect(a).toBe(b);
  });

  it('returns a new reference after push', () => {
    pushRecent('var');
    const a = getRecentSnapshot();
    pushRecent('cecl');
    const b = getRecentSnapshot();
    expect(a).not.toBe(b);
  });
});

describe('getRecentServerSnapshot', () => {
  it('always returns empty', () => {
    expect(getRecentServerSnapshot()).toEqual([]);
  });

  it('returns a stable reference', () => {
    expect(getRecentServerSnapshot()).toBe(getRecentServerSnapshot());
  });
});

// ─── subscribeRecent ────────────────────────────────────────────────────────

describe('subscribeRecent', () => {
  it('fires when pushRecent runs', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecent(listener);
    pushRecent('var');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops firing after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecent(listener);
    pushRecent('var');
    unsubscribe();
    pushRecent('cecl');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires on storage events for our key', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecent(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_SLOT, newValue: '["var"]' }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores storage events for other keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecent(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '[]' }));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
