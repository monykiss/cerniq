import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Page from '../page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/portal/benchmarks',
}));

// Mock i18n — return English locale
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: (k: string) => k, setLocale: vi.fn() }),
}));

// Mock recharts — render placeholders so chart area is detectable
vi.mock('recharts', () => ({
  RadarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="radar-chart">{children}</div>,
  Radar: ({ name }: { name: string }) => <div data-testid={`radar-${name}`} />,
  PolarGrid: () => <div data-testid="polar-grid" />,
  PolarAngleAxis: () => <div data-testid="polar-angle-axis" />,
  PolarRadiusAxis: () => <div data-testid="polar-radius-axis" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  Tooltip: () => <div data-testid="chart-tooltip" />,
}));

// Mock fetch for API calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: false,
  json: async () => ({}),
});
global.fetch = mockFetch;

describe('Benchmarks Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
  });

  it('renders the page heading with institution name', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Cooperativa de Ahorro Caguas')).toBeInTheDocument();
    });
  });

  it('shows the peer group selector with demo groups', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('Select peer group')).toBeInTheDocument();
    });
    expect(screen.getByText(/Auto \(0\.5x-2x assets\)/)).toBeInTheDocument();
    expect(screen.getByText(/Large CUs/)).toBeInTheDocument();
    expect(screen.getByText(/All PR Cooperativas/)).toBeInTheDocument();
  });

  it('shows the radar chart area', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('6 Key Metrics Comparison')).toBeInTheDocument();
    });
    expect(screen.getByTestId('radar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('shows the quartile rankings table with metric rows', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Quartile Rankings')).toBeInTheDocument();
    });
    // Check table headers
    expect(screen.getByText('Metric')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('Quartile')).toBeInTheDocument();
    // Check metric names from demo data
    expect(screen.getByText('Duration Gap')).toBeInTheDocument();
    expect(screen.getByText('NII Sensitivity (+200bp)')).toBeInTheDocument();
    expect(screen.getByText('EVE Change (+200bp)')).toBeInTheDocument();
    expect(screen.getByText('LCR')).toBeInTheDocument();
    expect(screen.getByText('Capital Ratio')).toBeInTheDocument();
    expect(screen.getByText('Net Worth / Assets')).toBeInTheDocument();
  });

  it('shows the COSSEC findings heatmap with categories', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText(/COSSEC Findings Heatmap/)).toBeInTheDocument();
    });
    // Check heatmap severity headers
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    // Check CAMEL category rows
    expect(screen.getByText('Capital Adequacy')).toBeInTheDocument();
    expect(screen.getByText('Asset Quality')).toBeInTheDocument();
    expect(screen.getByText('Management')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.getByText('Liquidity')).toBeInTheDocument();
    expect(screen.getByText('Sensitivity')).toBeInTheDocument();
    expect(screen.getByText('IT/Cyber')).toBeInTheDocument();
    expect(screen.getByText('BSA/AML')).toBeInTheDocument();
  });

  it('shows the anonymization notice', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText(/All peer data is anonymized/)).toBeInTheDocument();
    });
    expect(screen.getByText(/No individual institution names are displayed/)).toBeInTheDocument();
  });

  it('shows quartile badges (Q1-Q4) in the rankings table', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Quartile Rankings')).toBeInTheDocument();
    });
    // Demo data has: Q2, Q3, Q3, Q1, Q1, Q2
    const q1Badges = screen.getAllByText('Q1');
    expect(q1Badges.length).toBe(2);
    const q2Badges = screen.getAllByText('Q2');
    expect(q2Badges.length).toBe(2);
    const q3Badges = screen.getAllByText('Q3');
    expect(q3Badges.length).toBe(2);
  });

  it('shows the peer group label in the header', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Peer Group')).toBeInTheDocument();
    });
  });
});
