/**
 * NCUA RBC2 page — D1 shell-handling + real-backend-shape contract.
 *
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never a fabricated capital filing.
 *   • ok → renders the REAL backend shape (riskBasedCapitalRatio / isWell-
 *     Capitalized / {nameEs,exposure,charge} components). This is the
 *     regression that the old `validateRBC2` (which required `rbc2Ratio`) threw
 *     on — proving the page now consumes the live response instead of getDemo.
 *   • genuine server error → AlmPage's error screen, NO sample (getDemo dropped).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import RBC2Page from './page';

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

beforeEach(() => {
  vi.unstubAllGlobals();
  useALMMock.mockReturnValue({ selectedId: 'inst-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RBC2Page — D1 shells', () => {
  it('renders the honest gap (not a fabricated filing) on a data_unavailable shell', async () => {
    mockFetch({
      components: [],
      totalRiskWeightedAssets: null,
      totalRiskBasedCapitalCharge: null,
      netWorth: null,
      riskBasedCapitalRatio: null,
      isWellCapitalized: false,
      isAdequatelyCapitalized: false,
      surplus: null,
      narrativeEs: 'RBC2 no se puede calcular.',
      narrativeEn: 'RBC2 cannot be computed.',
      overallStatus: 'data_unavailable',
      gaps: [
        {
          field: 'rbc2.balanceSheet',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: 'Upload balance sheet items.',
        },
      ],
    });

    render(<RBC2Page />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
  });

  it('renders the REAL backend shape on an ok response (regression: old validate threw)', async () => {
    mockFetch({
      components: [
        { name: 'consumer loans', nameEs: 'préstamos consumo', riskWeight: 0.6, exposure: 180, charge: 108 },
      ],
      totalRiskWeightedAssets: 285.4,
      totalRiskBasedCapitalCharge: 285.4,
      netWorth: 32.8,
      riskBasedCapitalRatio: 11.49,
      isWellCapitalized: true,
      isAdequatelyCapitalized: true,
      surplus: 4.26,
      narrativeEs: 'Bien capitalizada.',
      narrativeEn: 'Well-capitalized institution.',
      overallStatus: 'compliant',
      gaps: [
        {
          field: 'rbc2.irrCharge.durationGap',
          reason: 'CALCULATION_FAILED',
          severity: 'WARNING',
          action: 'Wire DurationService.',
        },
      ],
    });

    render(<RBC2Page />);

    expect(await screen.findByText(/well capitalized/i)).toBeInTheDocument();
    // The ratio appears in both the MetricStrip and the status banner.
    expect(screen.getAllByText(/11\.49%/).length).toBeGreaterThan(0);
    // The standing IRR WARNING gap is disclosed, not hidden.
    expect(screen.getByText(/warning/i)).toBeInTheDocument();
    expect(screen.queryByText(/data unavailable/i)).toBeNull();
  });

  it('renders the error screen (no sample) on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<RBC2Page />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/well capitalized/i)).toBeNull();
  });
});
