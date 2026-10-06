'use client';

import { createContext, useContext, useState, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { Locale, TranslationKeys } from './types';
import { en } from './locales/en';
import { es } from './locales/es';

const translations: Record<Locale, TranslationKeys> = { en, es };
const STORAGE_KEY = 'cerniq_locale';
type TranslationValue = string | string[] | { [key: string]: TranslationValue };

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch { /* SSR or storage blocked */ }
  const nav = navigator.language || '';
  return nav.startsWith('es') ? 'es' : 'en';
}

function subscribeToLocaleStorage(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener('storage', handleStorage);
  };
}

function getNestedValue(obj: TranslationValue, path: string): string {
  const keys = path.split('.');
  let current: TranslationValue | undefined = obj;
  for (const key of keys) {
    if (current == null) return path;
    if (typeof current !== 'object' || Array.isArray(current)) {
      return path;
    }
    current = current[key];
  }
  return typeof current === 'string' ? current : path;
}

function getNestedArray(obj: TranslationValue, path: string): string[] {
  const keys = path.split('.');
  let current: TranslationValue | undefined = obj;
  for (const key of keys) {
    if (current == null) return [];
    if (typeof current !== 'object' || Array.isArray(current)) {
      return [];
    }
    current = current[key];
  }
  return Array.isArray(current) ? current.filter((value): value is string => typeof value === 'string') : [];
}

interface TranslationContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  ta: (key: string) => string[];
}

const TranslationContext = createContext<TranslationContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
  ta: () => [],
});

export function TranslationProvider({ children }: { children: ReactNode }) {
  const storedLocale = useSyncExternalStore<Locale>(subscribeToLocaleStorage, detectLocale, () => 'en');
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);
  const locale: Locale = localeOverride ?? storedLocale;

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleOverride(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch { /* storage blocked */ }
  }, []);

  const t = useCallback(
    (key: string): string => getNestedValue(translations[locale] as unknown as TranslationValue, key),
    [locale],
  );

  const ta = useCallback(
    (key: string): string[] => getNestedArray(translations[locale] as unknown as TranslationValue, key),
    [locale],
  );

  return (
    <TranslationContext.Provider value={{ locale, setLocale, t, ta }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
