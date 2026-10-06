"use client";

export const ADMIN_KEY_STORAGE = "cerniq_admin_key";
const LEGACY_ADMIN_KEY_STORAGE = "admin_key";

export function getStoredAdminKey(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const sessionKey = sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
  if (sessionKey) {
    return sessionKey;
  }

  const legacyKey = localStorage.getItem(LEGACY_ADMIN_KEY_STORAGE) || "";
  if (legacyKey) {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, legacyKey);
    localStorage.removeItem(LEGACY_ADMIN_KEY_STORAGE);
  }

  return legacyKey;
}

export function hasStoredAdminKey(): boolean {
  return Boolean(getStoredAdminKey());
}

export function persistAdminKey(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  localStorage.removeItem(LEGACY_ADMIN_KEY_STORAGE);
}

export function clearStoredAdminKey() {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  localStorage.removeItem(LEGACY_ADMIN_KEY_STORAGE);
}

export const clearAdminKey = clearStoredAdminKey;
