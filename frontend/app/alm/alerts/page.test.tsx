/**
 * Regulatory Alerts page — D1 contract.
 *
 *   • populated feed → renders the real alerts.
 *   • empty feed ([]) → the honest "No pending alerts" state (NOT a fabricated
 *     sample — getDemo dropped; an empty feed is a legit ok state).
 *   • genuine server error → AlmPage's error screen, NO sample.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AlertsPage from './page';

const { useALMMock } = vi.hoisted(() => ({ useALMMock: vi.fn() }));

vi.mock('@/components/alm/ALMProvider', () => ({ useALM: useALMMock }));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: () => [] }),
}));

function mockFetch(body: unknown, init?: ResponseInit) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useALMMock.mockReturnValue({ selectedId: 'inst-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlertsPage — D1', () => {
  it('renders the real alert feed', async () => {
    mockFetch([
      {
        id: 'a1',
        severity: 'HIGH',
        alertTextEs: 'Circular real de COSSEC.',
        alertTextEn: 'Real COSSEC circular published.',
        affectedItems: ['liquidity'],
        recommendedAction: 'Review LCR.',
        readAt: null,
        dismissedAt: null,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    render(<AlertsPage />);

    expect(await screen.findByText(/real cossec circular published/i)).toBeInTheDocument();
  });

  it('renders the honest empty state on an empty feed (no fabricated sample)', async () => {
    mockFetch([]);

    render(<AlertsPage />);

    expect(await screen.findByText(/no pending alerts/i)).toBeInTheDocument();
    // The former getDemo's fabricated circular must not appear.
    expect(screen.queryByText(/effective Jan 2027/i)).toBeNull();
  });

  it('renders the error screen (no sample) on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<AlertsPage />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });
});
