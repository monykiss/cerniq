/**
 * OAS page — D1 shell-handling contract.
 *
 * Locks in that the honest backend shells render honestly and never fall back
 * to the fabricated `getDemoData` sample:
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the demo's FNMA pool / 58.3 bps OAS.
 *   • ok + full → the instrument detail table.
 *   • genuine server error → the LABELED demo sample is still allowed (policy:
 *     quant pages keep getDemo as the network/500 fallback, now labeled).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode, SVGProps } from 'react';
import OASPage from './page';

const { getOASPortfolioMock, useALMMock } = vi.hoisted(() => ({
  getOASPortfolioMock: vi.fn(),
  useALMMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    getOASPortfolio: getOASPortfolioMock,
  },
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: useALMMock,
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    AlertTriangle: Icon,
    Layers: Icon,
    Building2: Icon,
  };
});

vi.mock('recharts', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Wrap,
    Bar: Wrap,
    XAxis: Wrap,
    YAxis: Wrap,
    CartesianGrid: Wrap,
    Tooltip: Wrap,
    Legend: Wrap,
    ResponsiveContainer: Wrap,
  };
});

const DATA_UNAVAILABLE_SHELL = {
  instruments: [],
  portfolioOAS: null,
  portfolioEffDuration: null,
  portfolioEffConvexity: null,
  totalOptionCost: null,
  totalBalance: null,
  status: 'data_unavailable',
  gaps: [
    {
      field: 'oas.balanceSheet',
      reason: 'EMPTY_BALANCE_SHEET',
      severity: 'CRITICAL',
      action: 'Load the balance sheet.',
    },
  ],
};

describe('OASPage', () => {
  beforeEach(() => {
    getOASPortfolioMock.mockReset();
    useALMMock.mockReset();
  });

  it('shows a coherent institution-required state when no institution is selected', () => {
    useALMMock.mockReturnValue({ selectedId: '' });

    render(<OASPage />);

    expect(screen.getByText(/institution required/i)).toBeInTheDocument();
    expect(screen.getByText(/open oas analysis/i)).toBeInTheDocument();
  });

  it('renders the honest gap (not the demo) on a data_unavailable shell', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getOASPortfolioMock.mockResolvedValue(DATA_UNAVAILABLE_SHELL);

    render(<OASPage />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    // The fabricated demo must NOT leak in on the honest shell.
    expect(screen.queryByText(/fnma 30y mbs pool/i)).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  it('renders the instrument detail table on a full ok shell', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getOASPortfolioMock.mockResolvedValue({
      instruments: [
        {
          instrumentId: 'r1', instrumentName: 'Real FHLB Note', category: 'asset', balance: 12,
          nominalSpread: 40, zSpread: 38, oas: 30, optionCost: 8,
          effectiveDuration: 3.0, effectiveConvexity: 0.4, modifiedDuration: 3.1,
        },
      ],
      portfolioOAS: 30, portfolioEffDuration: 3, portfolioEffConvexity: 0.4,
      totalOptionCost: 0.1, totalBalance: 12,
      status: 'ok',
    });

    render(<OASPage />);

    expect(await screen.findByText(/real fhlb note/i)).toBeInTheDocument();
    // No demo label on a live result.
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  it('still allows the LABELED demo sample on a genuine server error', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getOASPortfolioMock.mockRejectedValue(new Error('network down'));

    render(<OASPage />);

    expect(
      await screen.findByText(/oAS analysis — option-adjusted spreads/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/fnma 30y mbs pool/i)).toBeInTheDocument();
    // getDemo survives as the network/500 fallback — now accompanied by the
    // amber "Sample data" banner so the sample is honestly labeled.
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });
});
