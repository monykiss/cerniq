/**
 * NCUA 5300 Call Report page — D1 shell-handling contract.
 *
 *   • data_unavailable (empty balance sheet) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never a fabricated $445M Call Report.
 *   • ok → renders the real fields + summary.
 *   • genuine server error → AlmPage's error screen, NO sample (getDemo dropped).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RBC5300Page from './page';

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

describe('Form5300Page — D1 shells', () => {
  it('renders the honest gap (not a fabricated filing) on a data_unavailable shell', async () => {
    mockFetch({
      quarter: '2026Q1',
      charterNumber: null,
      fields: [],
      validationResult: { valid: false, errors: [], warnings: [] },
      summary: { totalAssets: 0, totalLiabilities: 0, netWorth: 0, netWorthRatio: 0, totalLoans: 0, totalShares: 0, totalInvestments: 0 },
      overallStatus: 'data_unavailable',
      gaps: [
        {
          field: 'form5300.balanceSheet',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: 'Upload balance sheet items.',
        },
      ],
    });

    render(<RBC5300Page />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    // No fabricated total leaks in.
    expect(screen.queryByText(/445/)).toBeNull();
  });

  it('renders the real fields + summary on an ok response', async () => {
    mockFetch({
      quarter: '2026Q2',
      charterNumber: '99999',
      fields: [
        { accountCode: '010', label: 'Real Cash', value: 12, schedule: 'A', sourceField: 'BalanceSheetItem.cash' },
      ],
      validationResult: { valid: true, errors: [], warnings: [] },
      summary: { totalAssets: 50, totalLiabilities: 40, netWorth: 10, netWorthRatio: 20, totalLoans: 30, totalShares: 35, totalInvestments: 8 },
      overallStatus: 'ok',
    });

    render(<RBC5300Page />);

    expect(await screen.findByText(/real cash/i)).toBeInTheDocument();
    expect(screen.queryByText(/data unavailable/i)).toBeNull();
  });

  it('renders the error screen (no sample) on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<RBC5300Page />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/real cash/i)).toBeNull();
  });
});
