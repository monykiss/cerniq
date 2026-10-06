/**
 * useAlmEndpoint — typed data-fetching hook for ALM module pages.
 *
 * Replaces the inline try/catch/setData/setIsDemo pattern that was repeated
 * across 35+ module pages:
 *
 *     try { setData(await fetch(...)); setIsDemo(false); }
 *     catch { setData(getDemoData()); setIsDemo(true); }  // <-- silent failure
 *
 * The inline form silently swaps to demo data on any fetch failure and hides
 * the real error. This hook fixes that by returning a discriminated union
 * with explicit error categorization, an explicit `source: 'api' | 'demo'`
 * flag, and a stable retry function.
 *
 * Endpoint URLs are resolved from `lib/alm/registry.ts`. Modules without an
 * `endpoint` field in the registry receive a `missing-endpoint` error at
 * runtime — add the endpoint to the registry, don't inline it.
 *
 * Design notes:
 *
 *   • No runtime validation library dependency. The `validate` callback is
 *     where the caller either trusts the response shape (`(raw) => raw as T`)
 *     or hand-writes a type guard (e.g. `if (typeof raw.var !== 'number')
 *     throw new Error(...)`). Callers are welcome to plug in Zod or any
 *     other validator here — the hook doesn't care, as long as validate
 *     either returns T or throws.
 *
 *   • `getDemo` is OPT-IN. If provided, fetch failures fall back to the
 *     demo data and the state's `source` field is set to 'demo' (never
 *     silent). If omitted, failures become explicit error states that the
 *     caller renders with <RetryButton> or equivalent.
 *
 *   • Abort on unmount via AbortController. Stale responses from a prior
 *     institution selection are safely discarded.
 *
 *   • `deps` is the caller's extra reactivity key (e.g. VaR confidence or
 *     horizon). We serialize into a single string so the effect deps are
 *     stable even if the caller passes a new array literal on each render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

import { getAlmModule, type AlmModuleSlug } from '@/lib/alm/registry';
import { getConfiguredApiOrigin } from '@/lib/api-base';

// ─── Sentry breadcrumb + fingerprint reporter ───────────────────────────────
//
// Sentry may or may not be initialised (see instrumentation-client.ts). All
// reporting is wrapped in try/catch so an uninitialised client never breaks
// the hook. We use addBreadcrumb + captureMessage with explicit level to
// avoid the hard-fail behaviour of captureException on network errors.
function reportAlmError(slug: string, error: AlmErrorInternal, url: string | null): void {
  try {
    Sentry.addBreadcrumb({
      category: 'alm-endpoint',
      type: 'http',
      level: error.kind === 'auth' || error.kind === 'not-found' ? 'warning' : 'error',
      message: `[alm/${slug}] ${error.kind}: ${error.message}`,
      data: {
        slug,
        kind: error.kind,
        url: url ?? 'n/a',
        status: error.status,
        retryAfter: error.retryAfter,
      },
    });

    // Only escalate to captureMessage for server/schema errors — auth/network
    // are expected during sessions expiring or going offline and would flood
    // Sentry if captured every time.
    if (error.kind === 'server' || error.kind === 'schema') {
      Sentry.captureMessage(`[alm/${slug}] ${error.kind}: ${error.message}`, {
        level: 'error',
        tags: {
          'alm.slug': slug,
          'alm.error_kind': error.kind,
          'alm.status': String(error.status ?? 'n/a'),
        },
      });
    }
  } catch {
    // Sentry uninitialised or throwing — never surface to the hook.
  }
}

// Interface used only inside the hook module so we can pass errors to the
// reporter before they become part of the public AlmError type.
type AlmErrorInternal = AlmError;

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlmErrorKind =
  | 'missing-endpoint'
  | 'no-institution'
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'server'
  | 'network'
  | 'schema';

export interface AlmError {
  readonly kind: AlmErrorKind;
  readonly message: string;
  /** HTTP status code (server/auth/not-found/rate-limit only) */
  readonly status?: number;
  /** Retry-After header value in seconds (rate-limit only) */
  readonly retryAfter?: number;
  /** Underlying cause (network only) */
  readonly cause?: unknown;
}

export type AlmEndpointState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'success';
      readonly data: T;
      /** 'api' = live response; 'demo' = opt-in fallback */
      readonly source: 'api' | 'demo';
      readonly refetch: () => void;
    }
  | {
      readonly status: 'error';
      readonly error: AlmError;
      readonly retry: () => void;
    };

export interface UseAlmEndpointOptions<T> {
  readonly institutionId: string | null | undefined;
  /**
   * Convert the raw response body into `T`. Throw to signal a schema
   * mismatch; return `T` to signal success. The simplest implementation is
   * `(raw) => raw as T` when you trust the endpoint.
   */
  readonly validate: (raw: unknown) => T;
  /**
   * Opt-in demo fallback. If provided, fetch/parse failures are rendered
   * as `{ status: 'success', source: 'demo' }` instead of errors.
   */
  readonly getDemo?: () => T;
  /**
   * Extra reactive dependencies beyond slug + institutionId (e.g. VaR's
   * `confidence` and `horizon` selectors).
   */
  readonly deps?: readonly unknown[];
  /**
   * Query string parameters to append to the resolved URL. Values of
   * `undefined` / `null` are skipped.
   */
  readonly queryParams?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /**
   * HTTP method. Defaults to 'GET'. Use 'POST' for endpoints that accept
   * a JSON body (common for quant endpoints that take scenario params).
   */
  readonly method?: 'GET' | 'POST';
  /**
   * Optional path suffix appended to the registry endpoint template after
   * {id} substitution. Used for secondary endpoints on a module that has
   * a primary endpoint in the registry.
   *
   *   registry endpoint: '/api/alm/{id}/cecl'
   *   pathSuffix:        '/forecast'
   *   resolved:          '/api/alm/<id>/cecl/forecast'
   *
   * The suffix must start with '/'. It is NOT URL-encoded — pass a literal
   * path, not user input.
   */
  readonly pathSuffix?: string;
  /**
   * Optional JSON body — only applied when method === 'POST'. Serialized
   * via JSON.stringify and sent with Content-Type: application/json.
   */
  readonly body?: unknown;
  /**
   * Optional fetch init override. `credentials` and `signal` are always
   * set by the hook and cannot be overridden.
   */
  readonly init?: Omit<RequestInit, 'credentials' | 'signal'>;
}

// ─── URL resolution ──────────────────────────────────────────────────────────

export function resolveAlmEndpoint(
  template: string,
  institutionId: string,
  queryParams?: UseAlmEndpointOptions<unknown>['queryParams'],
  pathSuffix?: string,
): string {
  const base = getConfiguredApiOrigin();
  let path = template.replace('{id}', encodeURIComponent(institutionId));
  if (pathSuffix) {
    // Ensure exactly one slash joining base path + suffix.
    const normalized = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
    path = path.replace(/\/+$/, '') + normalized;
  }
  const url = new URL((base || '') + path, 'http://placeholder.invalid');

  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  // Rebuild a clean URL. If base is empty (relative), strip the placeholder.
  if (!base) return url.pathname + url.search;
  return url.toString();
}

// ─── The hook ────────────────────────────────────────────────────────────────

export function useAlmEndpoint<T>(
  slug: AlmModuleSlug,
  options: UseAlmEndpointOptions<T>,
): AlmEndpointState<T> {
  const [state, setState] = useState<AlmEndpointState<T>>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);

  // Stabilize callback refs so effect deps don't thrash.
  const validateRef = useRef(options.validate);
  const getDemoRef = useRef(options.getDemo);
  validateRef.current = options.validate;
  getDemoRef.current = options.getDemo;

  const { institutionId, deps, queryParams, init, method = 'GET', body, pathSuffix } = options;

  // Serialize the reactive keys into a single string. queryParams is a plain
  // object so JSON.stringify is safe; deps is the caller's responsibility to
  // keep primitive-friendly.
  const depsKey = JSON.stringify({ slug, institutionId, queryParams, deps, method, body, pathSuffix, retryNonce });

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!institutionId) {
      // no-institution is often transient (ALMProvider is still booting).
      // We set error state but intentionally skip Sentry reporting to avoid
      // flooding the breadcrumb stream during page-load races.
      setState({
        status: 'error',
        error: { kind: 'no-institution', message: 'No institution selected.' },
        retry,
      });
      return;
    }

    const mod = getAlmModule(slug);
    if (!mod) {
      const error: AlmError = { kind: 'missing-endpoint', message: `Module "${slug}" is not registered in lib/alm/registry.ts.` };
      reportAlmError(slug, error, null);
      setState({ status: 'error', error, retry });
      return;
    }
    if (!mod.endpoint) {
      const error: AlmError = { kind: 'missing-endpoint', message: `Module "${slug}" has no endpoint in registry.` };
      reportAlmError(slug, error, null);
      setState({ status: 'error', error, retry });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    const url = resolveAlmEndpoint(mod.endpoint, institutionId, queryParams, pathSuffix);

    function applyError(error: AlmError) {
      if (controller.signal.aborted) return;
      // Report to Sentry FIRST so the breadcrumb exists even if the caller
      // falls back to demo data. Reporting is fully no-op when Sentry is
      // uninitialised and never throws up.
      reportAlmError(slug, error, url);
      const demo = getDemoRef.current;
      if (demo) {
        try {
          const data = demo();
          setState({ status: 'success', data, source: 'demo', refetch: retry });
          return;
        } catch {
          // demo factory itself threw — fall through to real error
        }
      }
      setState({ status: 'error', error, retry });
    }

    (async () => {
      try {
        const requestInit: RequestInit = {
          ...init,
          method,
          credentials: 'include',
          signal: controller.signal,
        };
        if (method === 'POST') {
          requestInit.headers = {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
          };
          requestInit.body = body !== undefined ? JSON.stringify(body) : '{}';
        }
        const res = await fetch(url, requestInit);

        if (controller.signal.aborted) return;

        if (res.status === 401) {
          return applyError({ kind: 'auth', message: 'Unauthorized — please sign in.', status: 401 });
        }
        if (res.status === 404) {
          return applyError({ kind: 'not-found', message: `Endpoint not found: ${url}`, status: 404 });
        }
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
          return applyError({
            kind: 'rate-limit',
            message: 'Rate limit exceeded.',
            status: 429,
            retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
          });
        }
        if (!res.ok) {
          return applyError({ kind: 'server', message: `HTTP ${res.status}`, status: res.status });
        }

        let raw: unknown;
        try {
          raw = await res.json();
        } catch {
          return applyError({ kind: 'schema', message: 'Response was not valid JSON.' });
        }

        let data: T;
        try {
          data = validateRef.current(raw);
        } catch (e) {
          return applyError({
            kind: 'schema',
            message: e instanceof Error ? e.message : 'Schema validation failed.',
          });
        }

        if (controller.signal.aborted) return;
        setState({ status: 'success', data, source: 'api', refetch: retry });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        applyError({ kind: 'network', message: 'Network request failed.', cause });
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depsKey is the serialized input
  }, [depsKey]);

  return state;
}

// ─── Presentation helpers ───────────────────────────────────────────────────

/** Bilingual fallback message for each error kind. */
export function formatAlmError(error: AlmError, locale: 'en' | 'es'): string {
  const en = locale === 'en';
  switch (error.kind) {
    case 'missing-endpoint':
      return en ? 'This module is not yet wired to a backend endpoint.' : 'Este módulo aún no está conectado a un endpoint.';
    case 'no-institution':
      return en ? 'Select an institution to load data.' : 'Seleccione una institución para cargar datos.';
    case 'auth':
      return en ? 'Your session expired. Please sign in again.' : 'Su sesión expiró. Por favor inicie sesión de nuevo.';
    case 'rate-limit':
      return en
        ? `Rate limit exceeded${error.retryAfter ? `. Retry in ${error.retryAfter}s.` : '.'}`
        : `Límite de tasa excedido${error.retryAfter ? `. Reintentar en ${error.retryAfter}s.` : '.'}`;
    case 'not-found':
      return en ? 'The requested data was not found.' : 'No se encontraron los datos solicitados.';
    case 'server':
      return en ? `Server error (${error.status ?? 'unknown'}). Please try again.` : `Error del servidor (${error.status ?? 'desconocido'}). Intente de nuevo.`;
    case 'network':
      return en ? 'Network error. Check your connection and retry.' : 'Error de red. Verifique su conexión y reintente.';
    case 'schema':
      return en ? 'The server returned an unexpected response shape.' : 'El servidor devolvió un formato inesperado.';
  }
}
