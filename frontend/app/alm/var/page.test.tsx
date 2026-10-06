/**
 * VaR Suite page — D1 shell-handling contract.
 *
 * Locks in that the honest backend shells from PortfolioVaRService render
 * honestly and never fall back to the fabricated `getDemo` sample (the phantom
 * $445M book):
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the demo's $445M / GREEN traffic light.
 *   • ok + partial (the common no-empirical-history case: real parametric VaR,
 *     null historical/Monte Carlo, null backtest, WARNING gaps) → the real
 *     parametric figure + `—` for the withheld methods + a WARNING gap banner +
 *     the "backtest withheld" note.
 *   • ok + full (≥500 daily obs) → all three methods + the Kupiec traffic light.
 *   • genuine server error → the LABELED demo sample is still allowed (policy:
 *     quant pages keep getDemo as the network/500 fallback, now labeled).
 *
 * The VaR page routes through <AlmPage> → useAlmEndpoint → fetch, so the shells
 * are driven by stubbing global fetch with a real Response (mirrors the
 * nim-attribution D1 test).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import VaRPage from './page';

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
    CartesianGrid: Wrap, Tooltip: Wrap, ResponsiveContainer: Wrap, Cell: Wrap,
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

// Shell fragments mirroring portfolio-var.service.ts. `nullResult` is the
// withheld-method shape (every numeric null); `realResult` carries live figures.
const nullResult = (method: string) => ({
  method, confidenceLevel: 0.95, horizon: 1,
  var: null, cvar: null, varPct: null, portfolioValue: null,
  status: 'data_unavailable',
});
const nullBacktest = {
  testDays: 250, exceptions: null, exceptionRate: null, expectedExceptions: null,
  kupiecLR: null, kupiecPValue: null, trafficLight: null, status: 'data_unavailable',
};

beforeEach(() => {
  vi.unstubAllGlobals();
  useALMMock.mockReturnValue({ selectedId: 'inst-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VaRPage — D1 shells', () => {
  // ─── data_unavailable shell ──────────────────────────────────────────────
  it('renders the honest gap (not the $445M demo) on a data_unavailable shell', async () => {
    mockFetch({
      historical: nullResult('historical'),
      parametric: nullResult('parametric'),
      montecarlo: nullResult('montecarlo'),
      backtestResult: nullBacktest,
      status: 'data_unavailable',
      gaps: [
        {
          field: 'var',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: 'Upload the institution’s asset balance sheet to compute VaR.',
        },
      ],
    });

    render(<VaRPage />);

    expect(await screen.findByText(/Data Unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    // The page header is preserved above the panel.
    expect(screen.getByText('VaR Suite')).toBeInTheDocument();
    // The fabricated demo must NOT leak in — no $445M, no GREEN light, no label.
    expect(screen.queryByText((t) => t.includes('445'))).toBeNull();
    expect(screen.queryByText('GREEN')).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  // ─── partial ok shell (no empirical market history) ──────────────────────
  it('renders real parametric VaR + — for withheld methods + a WARNING banner on a partial shell', async () => {
    mockFetch({
      historical: nullResult('historical'),
      parametric: {
        method: 'parametric', confidenceLevel: 0.95, horizon: 1,
        var: 1.2, cvar: 1.6, varPct: 1.2, portfolioValue: 100, status: 'ok',
      },
      montecarlo: nullResult('montecarlo'),
      backtestResult: nullBacktest,
      status: 'ok',
      gaps: [
        { field: 'var.historical', reason: 'STALE_SNAPSHOT', severity: 'WARNING', action: 'Load MarketDataSnapshot history.' },
        { field: 'var.montecarlo', reason: 'STALE_SNAPSHOT', severity: 'WARNING', action: 'No empirical vol estimate.' },
        { field: 'backtest', reason: 'STALE_SNAPSHOT', severity: 'WARNING', action: 'No realized market history.' },
        { field: 'var.parametric', reason: 'INDICATOR_NOT_WIRED', severity: 'WARNING', action: 'Fixed 5bps vol fallback.' },
      ],
    });

    render(<VaRPage />);

    // The WARNING gap banner discloses what is missing.
    expect(await screen.findByText(/warning/i)).toBeInTheDocument();
    // The real parametric portfolio value renders (not a `—`, not a fabricated 445).
    expect(screen.getByText(/\$100\.0M/)).toBeInTheDocument();
    // Withheld methods render as `—`, and the backtest is honestly withheld.
    expect(screen.getByText('Parametric (Delta-Normal)')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/backtest withheld/i)).toBeInTheDocument();
    // No traffic light (backtest unavailable) and no demo.
    expect(screen.queryByText('GREEN')).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText((t) => t.includes('445'))).toBeNull();
  });

  // ─── full ok shell (all three methods + backtest) ────────────────────────
  it('renders all three methods + the Kupiec traffic light on a full ok shell', async () => {
    mockFetch({
      historical: { method: 'historical', confidenceLevel: 0.95, horizon: 1, var: 9.3, cvar: 12.1, varPct: 4.65, portfolioValue: 200, status: 'ok' },
      parametric: { method: 'parametric', confidenceLevel: 0.95, horizon: 1, var: 8.7, cvar: 10.8, varPct: 4.35, portfolioValue: 200, status: 'ok' },
      montecarlo: { method: 'montecarlo', confidenceLevel: 0.95, horizon: 1, var: 9.5, cvar: 12.8, varPct: 4.75, portfolioValue: 200, status: 'ok' },
      backtestResult: { testDays: 250, exceptions: 3, exceptionRate: 0.012, expectedExceptions: 12.5, kupiecLR: 1.85, kupiecPValue: 0.1, trafficLight: 'GREEN', status: 'ok' },
      status: 'ok',
      gaps: [],
    });

    render(<VaRPage />);

    expect(await screen.findByText('GREEN')).toBeInTheDocument();
    expect(screen.getByText('Historical Simulation')).toBeInTheDocument();
    expect(screen.getByText('Monte Carlo')).toBeInTheDocument();
    expect(screen.getByText('Parametric (Delta-Normal)')).toBeInTheDocument();
    // No gaps → no gap banner; live result → no demo label.
    expect(screen.queryByText('view details')).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  // ─── genuine server error → LABELED demo ─────────────────────────────────
  it('still allows the LABELED demo sample on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<VaRPage />);

    // getDemo survives as the network/500 fallback — the demo $445M book +
    // GREEN traffic light render, accompanied by the amber "Sample data" banner.
    expect(await screen.findByText(/sample data/i)).toBeInTheDocument();
    expect(screen.getByText('GREEN')).toBeInTheDocument();
    expect(screen.getByText(/\$445/)).toBeInTheDocument();
  });
});
