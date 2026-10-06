/**
 * useInstitutionId — layered-resolver contract tests.
 *
 * The hook must honor this precedence:
 *   1. `?institutionId=` URL query param (highest — deep links win)
 *   2. `useALM().selectedId` when non-empty
 *   3. `undefined` (empty string ALM default context is absent, not present)
 *
 * These tests lock the contract against drift — if a future refactor
 * accidentally swaps priority or treats '' as a valid id, these fail loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInstitutionId } from '@/lib/hooks/useInstitutionId';

// Mock state — tests mutate these, the mocks read them.
let urlParam: string | null = null;
let almSelectedId = '';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'institutionId' ? urlParam : null),
  }),
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: () => ({
    selectedId: almSelectedId,
    institutions: [],
    loading: false,
    setSelectedId: vi.fn(),
    selectInstitution: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('useInstitutionId', () => {
  beforeEach(() => {
    urlParam = null;
    almSelectedId = '';
  });

  it('returns undefined when both URL param and ALM context are absent', () => {
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBeUndefined();
  });

  it('returns the URL param when only it is set', () => {
    urlParam = 'inst-url-123';
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBe('inst-url-123');
  });

  it('returns the ALM context selectedId when only it is set', () => {
    almSelectedId = 'inst-alm-456';
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBe('inst-alm-456');
  });

  it('prefers URL param over ALM context (deep links win)', () => {
    urlParam = 'inst-url-from-email';
    almSelectedId = 'inst-previously-selected';
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBe('inst-url-from-email');
  });

  it('treats empty-string ALM selectedId as absent (default-context guard)', () => {
    // ALMContext default is `selectedId: ''`. A common bug is treating that
    // as a real id — e.g. `if (selectedId) fetch(...)` evaluates truthy for
    // undefined but falsy for '' in some logic, so callers diverge. This
    // hook must return undefined so all callers converge.
    almSelectedId = '';
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBeUndefined();
  });

  it('falls through from empty URL to non-empty ALM context', () => {
    urlParam = null; // URL absent
    almSelectedId = 'inst-shell-selected';
    const { result } = renderHook(() => useInstitutionId());
    expect(result.current).toBe('inst-shell-selected');
  });
});
