/**
 * Network Intelligence page — D1 shell-handling contract.
 *
 *   • data_unavailable (no institutions loaded) → the neutral "Data Unavailable"
 *     panel + the CRITICAL gap, never the former fabricated 94-cooperativa /
 *     PREPA-contagion network.
 *   • ok + partial → the real league table + a WARNING banner for the network
 *     averages / systemic-risk / contagion indicators that are not yet wired
 *     (shown as `—`, never as hardcoded constants).
 *   • genuine server error → the LABELED demo sample.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SVGProps } from 'react';
import NetworkPage from './page';

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return { Globe: Icon, AlertTriangle: Icon };
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NetworkPage — D1 shells', () => {
  it('renders the honest gap (not the demo) on a data_unavailable shell', async () => {
    mockFetch({
      aggregates: {
        totalInstitutions: 0, totalSystemAssets: 0,
        avgCAMEL: null, avgNIM: null, avgLCR: null, avgNWR: null,
        systemicRiskScore: null, riskDistribution: null,
      },
      institutions: [],
      contagionRisks: [],
      status: 'data_unavailable',
      gaps: [
        {
          field: 'networkIntelligence.institutions',
          reason: 'MISSING_INSTITUTION',
          severity: 'CRITICAL',
          action: 'Load institutions with their balance sheets.',
        },
      ],
    });

    render(<NetworkPage />);

    expect(await screen.findByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    // The fabricated PREPA contagion must NOT leak in.
    expect(screen.queryByText(/PREPA/i)).toBeNull();
  });

  it('renders the real league table + a WARNING banner on a partial ok shell', async () => {
    mockFetch({
      aggregates: {
        totalInstitutions: 1, totalSystemAssets: 300,
        avgCAMEL: null, avgNIM: null, avgLCR: null, avgNWR: 9,
        systemicRiskScore: null, riskDistribution: null,
      },
      institutions: [
        { id: 'r1', name: 'Coop. Real Uno', totalAssets: 300, camelComposite: null, riskLevel: 'low', topRisk: 'IRR' },
      ],
      contagionRisks: [],
      status: 'ok',
      gaps: [
        {
          field: 'networkIntelligence.aggregates',
          reason: 'INDICATOR_NOT_WIRED',
          severity: 'WARNING',
          action: 'Per-institution CAMEL/NIM/LCR scoring is not yet wired.',
        },
      ],
    });

    render(<NetworkPage />);

    expect(await screen.findByText(/coop\. real uno/i)).toBeInTheDocument();
    expect(screen.getByText(/warning/i)).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/PREPA/i)).toBeNull();
  });

  it('still allows the LABELED demo sample on a genuine server error', async () => {
    const spy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', spy);

    render(<NetworkPage />);

    expect(await screen.findByText(/sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/coop\. oriental/i)).toBeInTheDocument();
  });
});
