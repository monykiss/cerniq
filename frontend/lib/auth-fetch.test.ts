import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessTokenMock = vi.fn<() => string>();
const syncSupabaseAccessTokenToStorageMock = vi.fn<() => Promise<string>>();

vi.mock('./api', () => ({
  getAccessToken: () => getAccessTokenMock(),
}));

vi.mock('./supabase/session', () => ({
  syncSupabaseAccessTokenToStorage: () =>
    syncSupabaseAccessTokenToStorageMock(),
}));

vi.mock('./api-base', () => ({
  getConfiguredApiOrigin: () => 'https://api.example.com',
}));

import { authFetch } from './auth-fetch';

function lastRequestInit(): RequestInit {
  const fetchMock = vi.mocked(global.fetch);
  return fetchMock.mock.calls[0]?.[1] as RequestInit;
}

function lastHeaders(): Headers {
  return lastRequestInit().headers as Headers;
}

describe('authFetch', () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    syncSupabaseAccessTokenToStorageMock.mockReset();
    getAccessTokenMock.mockReturnValue('stored-token');
    syncSupabaseAccessTokenToStorageMock.mockResolvedValue('');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the stored bearer token to same-origin API requests', async () => {
    await authFetch('/api/portal/overview');

    expect(lastHeaders().get('Authorization')).toBe('Bearer stored-token');
  });

  it('keeps credentials included so a restored cookie session still works', async () => {
    await authFetch('/api/portal/overview');

    expect(lastRequestInit().credentials).toBe('include');
  });

  // Regression guard: export downloads can point at object storage (R2 signed
  // URLs). Sending the session token there would leak a live credential to a
  // third-party host.
  it('never sends the bearer token to an untrusted host', async () => {
    await authFetch('https://storage.example.com/reports/report_es.pdf');

    expect(lastHeaders().has('Authorization')).toBe(false);
    expect(getAccessTokenMock).not.toHaveBeenCalled();
  });

  // File uploads post straight at the API origin to dodge the rewrite hop that
  // delivers a 0-byte multipart body — so that origin MUST still be credentialed.
  it('sends the bearer token to the configured API origin', async () => {
    await authFetch('https://api.example.com/api/portal/jobs/job-1/submit', {
      method: 'POST',
      body: new FormData(),
    });

    expect(lastHeaders().get('Authorization')).toBe('Bearer stored-token');
  });

  it('does not overwrite an Authorization header supplied by the caller', async () => {
    await authFetch('/api/portal/overview', {
      headers: { Authorization: 'Bearer caller-supplied' },
    });

    expect(lastHeaders().get('Authorization')).toBe('Bearer caller-supplied');
  });

  // The CSV upload sends FormData; the browser must set multipart/form-data
  // itself so the boundary matches the body.
  it('leaves Content-Type unset so FormData boundaries are browser-generated', async () => {
    await authFetch('/api/portal/jobs/job-1/submit', {
      method: 'POST',
      body: new FormData(),
    });

    expect(lastHeaders().has('Content-Type')).toBe(false);
  });

  it('falls back to a Supabase session sync when storage has no token', async () => {
    getAccessTokenMock.mockReturnValue('');
    syncSupabaseAccessTokenToStorageMock.mockResolvedValue('refreshed-token');

    await authFetch('/api/portal/overview');

    expect(lastHeaders().get('Authorization')).toBe('Bearer refreshed-token');
  });

  // Resolving a credential must degrade to an unauthenticated request so the
  // caller surfaces the server's 401, rather than reporting a network error.
  it('still issues the request when token resolution throws', async () => {
    getAccessTokenMock.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    await expect(authFetch('/api/portal/overview')).resolves.toEqual({
      ok: true,
    });
    expect(lastHeaders().has('Authorization')).toBe(false);
  });
});
