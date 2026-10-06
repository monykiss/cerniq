/**
 * Liquidity Transfer Pricing page — D1 shell-handling contract.
 *
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the demo's $2.05M total charge.
 *   • ok → the charge/credit KPIs from real data.
 *   • genuine server error → the LABELED demo sample.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode, SVGProps } from 'react';
import LTPPage from './page';

const { useALMMock } = vi.hoisted(() => ({ useALMMock: vi.fn() }));

vi.mock('@/components/alm/ALMProvider', () => ({ useALM: useALMMock }));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return { Banknote: Icon };
});

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

const FUNDING_CURVE = [
  { bucket: '0-3M', fundingCost: 0.05, riskFreeRate: 0.048, liquidityPremium: 0.002 },
];

beforeEach(() => {
  vi.unstubAllGlobals();
  useALMMock.mockReturnValue({ selectedId: 'inst-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LTPPage — D1 shells', () => {
  it('renders the honest gap (not the demo) on a data_unavailable shell', async () => {
    mockFetch({
      segments: [],
      internalFundingCurve: FUNDING_CURVE,
      totalLiquidityCharge: null,
      totalLiquidityCredit: null,
      netLTPTransfer: null,
      topConsumers: [],
      topProviders: [],
      status: 'data_unavailable',
      gaps: [
        {
          field: 'ltp.balanceSheet',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: 'Load the balance sheet.',
        },
      ],
    });

    render(<LTPPage />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/\$2\.05M/)).toBeNull();
  });

  it('renders real charge/credit KPIs on an ok shell', async () => {
    mockFetch({
      segments: [],
      internalFundingCurve: FUNDING_CURVE,
      totalLiquidityCharge: 1.1,
      totalLiquidityCredit: 0.9,
      netLTPTransfer: 0.2,
      topConsumers: [],
      topProviders: [],
      status: 'ok',
    });

    render(<LTPPage />);

    expect(
      await screen.findByText(/liquidity transfer pricing/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$1\.1M/)).toBeInTheDocument();
    expect(screen.queryByText(/data unavailable/i)).toBeNull();
  });

  it('still allows the LABELED demo sample on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<LTPPage />);

    expect(await screen.findByText(/sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/\$2\.05M/)).toBeInTheDocument();
  });
});
