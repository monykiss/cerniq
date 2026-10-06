/**
 * AlmPage shell contract tests.
 *
 * AlmPage wires the ALM page template together: header from registry,
 * loading/error/success states, retry wiring, demo banner, controls slot.
 * These tests lock in the three terminal states and the guardrail branches
 * (unregistered slug, missing endpoint, demo fallback).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AlmPage } from './AlmPage';

// ─── fetch mocking ──────────────────────────────────────────────────────────

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
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

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('AlmPage — happy path', () => {
  it('renders the registry-derived header for a known slug', async () => {
    mockFetch(async () => jsonResponse({ var: 1, cvar: 2 }));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as { var: number; cvar: number }}
      >
        {(data) => <div data-testid="content">v={data.var}</div>}
      </AlmPage>,
    );

    // Header from registry — the VaR Suite name appears immediately
    expect(screen.getByText('VaR Suite')).toBeInTheDocument();
    // Description from registry
    expect(screen.getByText(/Historical.*Parametric.*Monte Carlo/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('content')).toBeInTheDocument());
    expect(screen.getByTestId('content')).toHaveTextContent('v=1');
  });

  it('renders a spinner with role=status during loading', async () => {
    // Never-resolving fetch keeps us in the loading state
    mockFetch(() => new Promise<Response>(() => {}));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as unknown}
      >
        {() => <div>should not render</div>}
      </AlmPage>,
    );

    const status = await screen.findByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the controls slot in the header in every state', () => {
    mockFetch(() => new Promise<Response>(() => {}));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as unknown}
        controls={<button type="button" data-testid="ctl">Ctl</button>}
      >
        {() => <div>child</div>}
      </AlmPage>,
    );

    expect(screen.getByTestId('ctl')).toBeInTheDocument();
    // Header is still visible even though content is loading
    expect(screen.getByText('VaR Suite')).toBeInTheDocument();
  });
});

// ─── Error state ─────────────────────────────────────────────────────────────

describe('AlmPage — error state', () => {
  it('renders retry UI with a bilingual message on server error', async () => {
    mockFetch(async () => new Response('', { status: 500 }));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as unknown}
      >
        {() => <div>should not render</div>}
      </AlmPage>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Could not load/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retry button triggers a refetch', async () => {
    const fetchSpy = mockFetch(async () => new Response('', { status: 500 }));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as unknown}
      >
        {() => <div>should not render</div>}
      </AlmPage>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    const user = userEvent.setup();
    await user.click(retryBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('renders a hard-stop for an unknown slug', () => {
    // We bypass TS by casting — the runtime branch is what we want to cover.
    render(
      // @ts-expect-error — intentionally unregistered
      <AlmPage slug="this-module-does-not-exist" institutionIdOverride="inst_test" validate={(x) => x}>
        {() => <div>should not render</div>}
      </AlmPage>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/not registered/i)).toBeInTheDocument();
  });
});

// ─── Demo fallback ───────────────────────────────────────────────────────────

describe('AlmPage — demo banner', () => {
  it('shows the sample data banner when source=demo', async () => {
    mockFetch(async () => new Response('', { status: 500 }));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as { var: number }}
        getDemo={() => ({ var: 42 })}
      >
        {(data) => <div data-testid="content">v={data.var}</div>}
      </AlmPage>,
    );

    await waitFor(() => expect(screen.getByTestId('content')).toHaveTextContent('v=42'));
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/Sample data/i)).toBeInTheDocument();
  });

  it('does not show the demo banner on real API success', async () => {
    mockFetch(async () => jsonResponse({ var: 99 }));

    render(
      <AlmPage
        slug="var"
        institutionIdOverride="inst_test"
        validate={(raw) => raw as { var: number }}
        getDemo={() => ({ var: 42 })}
      >
        {(data) => <div data-testid="content">v={data.var}</div>}
      </AlmPage>,
    );

    await waitFor(() => expect(screen.getByTestId('content')).toHaveTextContent('v=99'));
    expect(screen.queryByText(/Sample data/i)).toBeNull();
  });
});

// ─── Status badges ───────────────────────────────────────────────────────────

describe('AlmPage — status badges', () => {
  it('renders a BETA badge for modules with status=beta', () => {
    mockFetch(() => new Promise<Response>(() => {}));

    render(
      <AlmPage
        slug="network" /* registered as beta in the registry */
        institutionIdOverride="inst_test"
        validate={(raw) => raw as unknown}
      >
        {() => <div>child</div>}
      </AlmPage>,
    );

    expect(screen.getByText('beta')).toBeInTheDocument();
  });
});
