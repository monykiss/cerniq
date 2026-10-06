/**
 * SOFR Transition page — D1 shell-handling contract.
 *
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the demo's $38.7M LIBOR exposure.
 *   • ok → the KPI strip + exposure inventory from real data.
 *   • genuine server error → the LABELED demo sample (policy: quant pages keep
 *     getDemo as the network/500 fallback, now labeled).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SVGProps } from 'react';
import SOFRExposurePage from './page';

const { getSOFRExposureMock, useALMMock } = vi.hoisted(() => ({
  getSOFRExposureMock: vi.fn(),
  useALMMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: { getSOFRExposure: getSOFRExposureMock },
}));

vi.mock('@/components/alm/ALMProvider', () => ({ useALM: useALMMock }));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return { RefreshCw: Icon, Check: Icon, Clock: Icon, Circle: Icon, Building2: Icon, AlertTriangle: Icon };
});

const DATA_UNAVAILABLE_SHELL = {
  exposures: [],
  totalLIBORExposure: null,
  totalSOFRExposure: null,
  totalValueTransfer: null,
  pctPortfolioExposed: null,
  transitionChecklist: [],
  status: 'data_unavailable',
  gaps: [
    {
      field: 'sofrMonitor.balanceSheet',
      reason: 'EMPTY_BALANCE_SHEET',
      severity: 'CRITICAL',
      action: 'Load the balance sheet.',
    },
  ],
};

describe('SOFRExposurePage — D1 shells', () => {
  beforeEach(() => {
    getSOFRExposureMock.mockReset();
    useALMMock.mockReset();
  });

  it('requires an institution selection', () => {
    useALMMock.mockReturnValue({ selectedId: '' });
    render(<SOFRExposurePage />);
    expect(screen.getByText(/institution required/i)).toBeInTheDocument();
  });

  it('renders the honest gap (not the demo) on a data_unavailable shell', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getSOFRExposureMock.mockResolvedValue(DATA_UNAVAILABLE_SHELL);

    render(<SOFRExposurePage />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    // No fabricated exposure figure leaks in.
    expect(screen.queryByText(/\$38\.7M/)).toBeNull();
  });

  it('renders real KPIs on an ok shell', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getSOFRExposureMock.mockResolvedValue({
      exposures: [],
      totalLIBORExposure: 0,
      totalSOFRExposure: 12.5,
      totalValueTransfer: 0,
      pctPortfolioExposed: 0,
      transitionChecklist: [],
      status: 'ok',
    });

    render(<SOFRExposurePage />);

    // A measured ZERO is a number ($0.0M), not a `—` and not data_unavailable.
    expect(await screen.findByText(/sofr transition monitor/i)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0M/)).toBeInTheDocument();
    expect(screen.queryByText(/data unavailable/i)).toBeNull();
  });

  it('still allows the LABELED demo sample on a genuine server error', async () => {
    useALMMock.mockReturnValue({ selectedId: 'inst-1' });
    getSOFRExposureMock.mockRejectedValue(new Error('network down'));

    render(<SOFRExposurePage />);

    expect(await screen.findByText(/sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/\$38\.7M/)).toBeInTheDocument();
  });
});
