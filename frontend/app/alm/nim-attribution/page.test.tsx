/**
 * NIM Attribution page — D1 shell-handling contract.
 *
 * Locks in that the honest backend shells render honestly and never fall back
 * to the fabricated `getDemo` sample:
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the demo's 3.42% NIM.
 *   • ok + partial (real nimCurrent, null prior, empty attribution, WARNING
 *     gap) → the real NIM strip + a gap banner + the "no prior NIM" note.
 *   • ok + full → the factor waterfall + detail table.
 *   • genuine server error → the LABELED demo sample is still allowed (policy:
 *     quant pages keep getDemo as the network/500 fallback).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import NIMAttributionPage from './page';

// ─── mocks ───────────────────────────────────────────────────────────────────

const { useALMMock } = vi.hoisted(() => ({ useALMMock: vi.fn() }));

vi.mock('@/components/alm/ALMProvider', () => ({ useALM: useALMMock }));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: () => [] }),
}));

vi.mock('recharts', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Wrap, Bar: Wrap, XAxis: Wrap, YAxis: Wrap,
    CartesianGrid: Wrap, Tooltip: Wrap, ResponsiveContainer: Wrap,
    Cell: Wrap, ReferenceLine: Wrap,
  };
});

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

const FACTORS = [
  { factor: 'Rate Environment', factorEs: 'Entorno de Tasas', bps: -9, explanation: 'Fed.', explanationEs: 'Fed.' },
  { factor: 'Deposit Beta', factorEs: 'Beta', bps: -7, explanation: 'Cost.', explanationEs: 'Costo.' },
];

beforeEach(() => {
  vi.unstubAllGlobals();
  useALMMock.mockReturnValue({ selectedId: 'inst-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── data_unavailable shell ────────────────────────────────────────────────

describe('NIMAttributionPage — D1 shells', () => {
  it('renders the honest gap (not the demo) on a data_unavailable shell', async () => {
    mockFetch({
      nimCurrent: null,
      nimPrior: null,
      nimDeltaBps: null,
      attribution: [],
      totalExplainedBps: null,
      residualBps: null,
      status: 'data_unavailable',
      gaps: [
        {
          field: 'nimAttribution.balanceSheet',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: 'Load the balance sheet.',
        },
      ],
    });

    render(<NIMAttributionPage />);

    expect(await screen.findByText(/Data Unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    // The fabricated demo must NOT leak in — no factor table, no demo NIM.
    expect(screen.queryByText(/Factor Detail/i)).toBeNull();
    expect(screen.queryByText(/3\.42/)).toBeNull();
  });

  it('renders real NIM + a WARNING banner + the no-prior note on a partial shell', async () => {
    mockFetch({
      nimCurrent: 3.91,
      nimPrior: null,
      nimDeltaBps: null,
      attribution: [],
      totalExplainedBps: null,
      residualBps: null,
      status: 'ok',
      gaps: [
        {
          field: 'nimAttribution.nimPrior',
          reason: 'COSSEC_INPUTS_INSUFFICIENT',
          severity: 'WARNING',
          action: 'Generate a board report to set a baseline.',
        },
      ],
    });

    render(<NIMAttributionPage />);

    expect(await screen.findByText(/no prior NIM/i)).toBeInTheDocument();
    expect(screen.getByText(/warning/i)).toBeInTheDocument();
    // Real current NIM is shown (NumberCell renders "3.91%"), not a `—`.
    expect(screen.getByText(/3\.91/)).toBeInTheDocument();
  });

  it('renders the factor waterfall + table on a full ok shell', async () => {
    mockFetch({
      nimCurrent: 3.42,
      nimPrior: 3.68,
      nimDeltaBps: -26,
      attribution: FACTORS,
      totalExplainedBps: -16,
      residualBps: -10,
      status: 'ok',
    });

    render(<NIMAttributionPage />);

    expect(await screen.findByText(/Factor Detail/i)).toBeInTheDocument();
    expect(screen.getByText('Rate Environment')).toBeInTheDocument();
  });

  it('still allows the LABELED demo sample on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<NIMAttributionPage />);

    // getDemo survives as the network/500 fallback — the factor detail renders
    // from the demo, accompanied by the amber "Sample data" banner.
    expect(await screen.findByText(/Factor Detail/i)).toBeInTheDocument();
    expect(screen.getByText(/Sample data/i)).toBeInTheDocument();
  });
});
