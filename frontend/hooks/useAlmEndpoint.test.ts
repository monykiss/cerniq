/**
 * useAlmEndpoint — hook contract tests.
 *
 * We mock global fetch and render the hook in isolation via
 * @testing-library/react's renderHook. Each test exercises one of the 8
 * error kinds or a success path. The goal is to lock in the discriminated-
 * union contract — if anyone refactors the hook and silently changes which
 * HTTP code maps to which kind, one of these tests will fail.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  useAlmEndpoint,
  resolveAlmEndpoint,
  formatAlmError,
  type AlmError,
} from './useAlmEndpoint';

// A slug guaranteed to exist in the registry with an endpoint.
// 'var' has endpoint '/api/alm/{id}/var'.
const VAR_SLUG = 'var' as const;

// Default institution id used across tests.
const INSTITUTION_ID = 'inst_test_123';

// Minimal valid response the 'var' validator would accept; tests override.
const OK_RESPONSE = { ok: true, value: 42 };

const identityValidate = <T,>(raw: unknown) => raw as T;

// ─── fetch mock plumbing ────────────────────────────────────────────────────

function mockFetchOnce(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── resolveAlmEndpoint ──────────────────────────────────────────────────────

describe('resolveAlmEndpoint', () => {
  it('substitutes {id} placeholder', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/var', 'abc');
    expect(url).toBe('/api/alm/abc/var');
  });

  it('URL-encodes the institution id', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/var', 'inst with space');
    expect(url).toBe('/api/alm/inst%20with%20space/var');
  });

  it('appends query parameters when provided', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/var', 'abc', { confidence: 95, horizon: 1 });
    expect(url).toContain('confidence=95');
    expect(url).toContain('horizon=1');
  });

  it('skips null/undefined/empty-string query params', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/var', 'abc', {
      a: 1,
      b: null,
      c: undefined,
      d: '',
    });
    expect(url).toContain('a=1');
    expect(url).not.toContain('b=');
    expect(url).not.toContain('c=');
    expect(url).not.toContain('d=');
  });

  it('appends pathSuffix after {id} substitution', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/cecl', 'abc', undefined, '/forecast');
    expect(url).toBe('/api/alm/abc/cecl/forecast');
  });

  it('auto-prefixes slash on pathSuffix when missing', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/cecl', 'abc', undefined, 'forecast');
    expect(url).toBe('/api/alm/abc/cecl/forecast');
  });

  it('combines pathSuffix and queryParams correctly', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/cecl', 'abc', { method: 'warm' }, '/forecast');
    expect(url).toContain('/api/alm/abc/cecl/forecast');
    expect(url).toContain('method=warm');
  });

  it('normalizes trailing slash on base template before appending suffix', () => {
    const url = resolveAlmEndpoint('/api/alm/{id}/cecl/', 'abc', undefined, '/forecast');
    expect(url).toBe('/api/alm/abc/cecl/forecast');
  });
});

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('useAlmEndpoint — success', () => {
  it('fetches, validates, and returns success with source=api', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current).toMatchObject({ status: 'success', source: 'api', data: OK_RESPONSE });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toContain('/api/alm/inst_test_123/var');
  });

  it('passes queryParams through to the fetch URL', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        queryParams: { confidence: 99, horizon: 10 },
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('confidence=99');
    expect(url).toContain('horizon=10');
  });

  it('refetches when retry is called', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Capture the success snapshot so TypeScript narrowing survives across
    // the async act() boundary (each `result.current` access re-reads).
    const successState = result.current;
    if (successState.status !== 'success') throw new Error('unreachable');
    await act(async () => {
      successState.refetch();
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});

// ─── POST + body serialization ──────────────────────────────────────────────

describe('useAlmEndpoint — POST method', () => {
  it('sends POST with JSON Content-Type when method=POST', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        method: 'POST',
        body: { confidence: 99 },
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
  });

  it('serializes the body via JSON.stringify', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));
    const body = { numPaths: 500, horizonYears: 5 };

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        method: 'POST',
        body,
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it('defaults to empty {} body when body is omitted on POST', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        method: 'POST',
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.body).toBe('{}');
  });

  it('GET requests never include a body or Content-Type header', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });
});

// ─── pathSuffix support ────────────────────────────────────────────────────

describe('useAlmEndpoint — pathSuffix', () => {
  it('appends pathSuffix to the resolved URL', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>('cecl', {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        pathSuffix: '/forecast',
      }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/api/alm/${INSTITUTION_ID}/cecl/forecast`);
  });

  it('changing pathSuffix re-triggers the fetch', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    const { rerender } = renderHook(
      ({ suffix }: { suffix: string }) =>
        useAlmEndpoint<typeof OK_RESPONSE>('cecl', {
          institutionId: INSTITUTION_ID,
          validate: identityValidate,
          pathSuffix: suffix,
        }),
      { initialProps: { suffix: '/forecast' } },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    rerender({ suffix: '/backtest' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const secondUrl = fetchSpy.mock.calls[1]![0] as string;
    expect(secondUrl).toContain('/cecl/backtest');
  });
});

// ─── Error kinds ────────────────────────────────────────────────────────────

describe('useAlmEndpoint — error categorization', () => {
  it('no-institution when institutionId is null', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: null,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('no-institution');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('auth on 401', async () => {
    mockFetchOnce(async () => new Response('', { status: 401 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('auth');
    expect(result.current.error.status).toBe(401);
  });

  it('not-found on 404', async () => {
    mockFetchOnce(async () => new Response('', { status: 404 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('not-found');
  });

  it('rate-limit on 429 with retryAfter', async () => {
    mockFetchOnce(async () =>
      new Response('', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    );

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('rate-limit');
    expect(result.current.error.retryAfter).toBe(30);
  });

  it('server on 500', async () => {
    mockFetchOnce(async () => new Response('boom', { status: 500 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('server');
    expect(result.current.error.status).toBe(500);
  });

  it('network when fetch throws', async () => {
    mockFetchOnce(async () => {
      throw new TypeError('Failed to fetch');
    });

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('network');
  });

  it('schema when response is not JSON', async () => {
    mockFetchOnce(async () => new Response('not json at all', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof OK_RESPONSE>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('schema');
  });

  it('schema when validate throws', async () => {
    mockFetchOnce(async () => jsonResponse({ wrong: 'shape' }));

    const { result } = renderHook(() =>
      useAlmEndpoint(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: () => { throw new Error('nope'); },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('schema');
    expect(result.current.error.message).toContain('nope');
  });

  it('missing-endpoint when slug has no endpoint in registry', async () => {
    // 'modules' is a registered module (the /alm/modules index) but has no
    // backend endpoint — perfect negative fixture.
    mockFetchOnce(async () => jsonResponse(OK_RESPONSE));

    const { result } = renderHook(() =>
      useAlmEndpoint('modules', {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('missing-endpoint');
  });
});

// ─── Demo fallback ───────────────────────────────────────────────────────────

describe('useAlmEndpoint — demo fallback', () => {
  const demoValue = { ok: true, value: 999 };

  it('falls back to demo on server error when getDemo is provided', async () => {
    mockFetchOnce(async () => new Response('', { status: 500 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof demoValue>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        getDemo: () => demoValue,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    if (result.current.status !== 'success') throw new Error('unreachable');
    expect(result.current.source).toBe('demo');
    expect(result.current.data).toEqual(demoValue);
  });

  it('falls back to demo on network error when getDemo is provided', async () => {
    mockFetchOnce(async () => { throw new TypeError('boom'); });

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof demoValue>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        getDemo: () => demoValue,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    if (result.current.status !== 'success') throw new Error('unreachable');
    expect(result.current.source).toBe('demo');
  });

  it('surfaces error explicitly when getDemo is NOT provided (opt-out)', async () => {
    mockFetchOnce(async () => new Response('', { status: 500 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof demoValue>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('demo factory throwing falls through to the real error', async () => {
    mockFetchOnce(async () => new Response('', { status: 500 }));

    const { result } = renderHook(() =>
      useAlmEndpoint<typeof demoValue>(VAR_SLUG, {
        institutionId: INSTITUTION_ID,
        validate: identityValidate,
        getDemo: () => { throw new Error('demo broken too'); },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.kind).toBe('server');
  });
});

// ─── formatAlmError ──────────────────────────────────────────────────────────

describe('formatAlmError', () => {
  const base: AlmError = { kind: 'auth', message: 'raw' };

  it('returns bilingual messages for every kind', () => {
    const kinds: AlmError['kind'][] = [
      'missing-endpoint', 'no-institution', 'auth', 'rate-limit',
      'not-found', 'server', 'network', 'schema',
    ];
    for (const kind of kinds) {
      expect(formatAlmError({ ...base, kind } as AlmError, 'en').length).toBeGreaterThan(0);
      expect(formatAlmError({ ...base, kind } as AlmError, 'es').length).toBeGreaterThan(0);
    }
  });

  it('includes retryAfter in rate-limit message', () => {
    const en = formatAlmError({ kind: 'rate-limit', message: '', retryAfter: 45 }, 'en');
    expect(en).toContain('45');
  });

  it('includes status in server error message', () => {
    const en = formatAlmError({ kind: 'server', message: '', status: 503 }, 'en');
    expect(en).toContain('503');
  });
});
