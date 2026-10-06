/**
 * Organization context for K-Lytics tenancy headers.
 * Shares storage key with useCurrentOrg (Close Cockpit).
 */
export const CURRENT_ORG_STORAGE_KEY = 'cerniq:current_org_id';

export function getStoredOrganizationId(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredOrganizationId(id: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (id) {
      window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(CURRENT_ORG_STORAGE_KEY);
    }
  } catch {
    // privacy mode — swallow
  }
}
