import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertFeed from './alert-feed';
import type { AgentAlertRecord } from '@/types/agents';

// ─── Mock agents-api ────────────────────────────────────────────────────────

const listAlertsMock = vi.fn<() => Promise<AgentAlertRecord[]>>();
const ackAlertMock = vi.fn();

vi.mock('@/lib/agents-api', () => ({
  listAlerts: () => listAlertsMock(),
  ackAlert: (...args: unknown[]) => ackAlertMock(...args),
}));

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<AgentAlertRecord> = {}): AgentAlertRecord {
  return {
    id: 'alert-1',
    runId: 'run-1',
    institutionId: 'inst-1',
    category: 'liquidity',
    severity: 'HIGH',
    status: 'OPEN',
    metric: 'Duration Gap',
    currentValue: 3.8,
    threshold: 3.0,
    delta: -0.8,
    finding: 'Duration gap exceeds policy limit',
    findingEs: 'Brecha de duracion excede el limite de la politica',
    recommendation: 'Review fixed-rate loan portfolio',
    regulatoryRef: 'NCUA 741.3',
    deadline: '2026-05-15',
    dedupKey: 'abc123',
    notifiedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolutionNote: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    ...overrides,
  };
}

const mockAlerts: AgentAlertRecord[] = [
  makeAlert({
    id: 'alert-1',
    severity: 'CRITICAL',
    category: 'liquidity',
    metric: 'Liquidity Coverage Ratio',
    currentValue: 85,
    threshold: 100,
    finding: 'LCR below minimum threshold',
    findingEs: 'LCR por debajo del umbral minimo',
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago — newest
  }),
  makeAlert({
    id: 'alert-2',
    severity: 'HIGH',
    category: 'rate_risk',
    metric: 'Duration Gap',
    currentValue: 3.8,
    threshold: 3.0,
    finding: 'Duration gap exceeds policy limit',
    findingEs: 'Brecha de duracion excede el limite',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  }),
  makeAlert({
    id: 'alert-3',
    severity: 'MEDIUM',
    category: 'capital',
    status: 'ACKNOWLEDGED',
    metric: 'Net Worth Ratio',
    currentValue: 7.5,
    threshold: 7.0,
    finding: 'Net worth ratio approaching regulatory minimum',
    findingEs: 'Ratio de patrimonio neto acercandose al minimo regulatorio',
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago
  }),
  makeAlert({
    id: 'alert-4',
    severity: 'LOW',
    category: 'peer_standing',
    status: 'RESOLVED',
    metric: 'Peer Rank',
    currentValue: 15,
    threshold: 10,
    finding: 'Peer ranking dropped below top quartile',
    findingEs: 'Clasificacion de pares cayo debajo del cuartil superior',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1d ago
  }),
];

// ─── Setup/teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listAlertsMock.mockResolvedValue(mockAlerts);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AlertFeed', () => {
  // ─── Rendering & sorting ────────────────────────────────────────────────

  it('renders alerts sorted by date (newest first)', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('alert-row');
    expect(rows.length).toBe(4);

    // First row should be the newest (alert-1, CRITICAL, 1h ago)
    const firstRow = rows[0];
    expect(within(firstRow).getByTestId('severity-badge-CRITICAL')).toBeInTheDocument();

    // Last row should be oldest
    const lastRow = rows[rows.length - 1];
    expect(within(lastRow).getByTestId('severity-badge-LOW')).toBeInTheDocument();
  });

  // ─── Severity badge colors ─────────────────────────────────────────────

  it('renders CRITICAL severity badge with correct styling', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const criticalBadge = screen.getByTestId('severity-badge-CRITICAL');
    expect(criticalBadge).toHaveTextContent('Critical');
    expect(criticalBadge.className).toContain('bg-rose-100');
    expect(criticalBadge.className).toContain('text-rose-700');
  });

  it('renders HIGH severity badge with correct styling', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const highBadge = screen.getByTestId('severity-badge-HIGH');
    expect(highBadge).toHaveTextContent('High');
    expect(highBadge.className).toContain('bg-orange-100');
    expect(highBadge.className).toContain('text-orange-700');
  });

  it('renders MEDIUM severity badge with correct styling', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const mediumBadge = screen.getByTestId('severity-badge-MEDIUM');
    expect(mediumBadge).toHaveTextContent('Medium');
    expect(mediumBadge.className).toContain('bg-amber-100');
    expect(mediumBadge.className).toContain('text-amber-700');
  });

  it('renders LOW severity badge with correct styling', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const lowBadge = screen.getByTestId('severity-badge-LOW');
    expect(lowBadge).toHaveTextContent('Low');
    expect(lowBadge.className).toContain('bg-sky-100');
    expect(lowBadge.className).toContain('text-sky-700');
  });

  // ─── Filters ──────────────────────────────────────────────────────────

  it('filters by severity', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AlertFeed institutionId="inst-1" showFilters />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    // Initially all 4 alerts visible
    expect(screen.getAllByTestId('alert-row').length).toBe(4);

    // Filter to CRITICAL only
    const severitySelect = screen.getByLabelText('Severity');
    await user.selectOptions(severitySelect, 'CRITICAL');

    await waitFor(() => {
      expect(screen.getAllByTestId('alert-row').length).toBe(1);
    });
    expect(screen.getByTestId('severity-badge-CRITICAL')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AlertFeed institutionId="inst-1" showFilters />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    // Filter to ACKNOWLEDGED
    const statusSelect = screen.getByLabelText('Status');
    await user.selectOptions(statusSelect, 'ACKNOWLEDGED');

    await waitFor(() => {
      expect(screen.getAllByTestId('alert-row').length).toBe(1);
    });
    expect(screen.getByTestId('severity-badge-MEDIUM')).toBeInTheDocument();
  });

  it('filters by agent', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AlertFeed institutionId="inst-1" showFilters />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    // Filter to Capital Optimizer (only the MEDIUM alert with category 'capital')
    const agentSelect = screen.getByLabelText('Agent');
    await user.selectOptions(agentSelect, 'Capital Optimizer');

    await waitFor(() => {
      expect(screen.getAllByTestId('alert-row').length).toBe(1);
    });
  });

  it('shows filtered empty state when no alerts match filters', async () => {
    listAlertsMock.mockResolvedValue([
      makeAlert({ id: 'alert-1', severity: 'LOW', status: 'RESOLVED' }),
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<AlertFeed institutionId="inst-1" showFilters />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    // Filter to CRITICAL — no match
    const severitySelect = screen.getByLabelText('Severity');
    await user.selectOptions(severitySelect, 'CRITICAL');

    await waitFor(() => {
      expect(screen.getByTestId('alert-empty-state')).toBeInTheDocument();
    });
    expect(
      screen.getByText('No alerts match the current filters'),
    ).toBeInTheDocument();
  });

  // ─── Empty state ──────────────────────────────────────────────────────

  it('renders empty state when no alerts exist', async () => {
    listAlertsMock.mockResolvedValue([]);

    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No alerts to display')).toBeInTheDocument();
  });

  // ─── Bilingual text ───────────────────────────────────────────────────

  it('renders English text by default', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    expect(screen.getByText('Alert Feed')).toBeInTheDocument();
    // Check English finding text appears
    expect(screen.getByText('LCR below minimum threshold')).toBeInTheDocument();
  });

  it('renders Spanish text when locale=es', async () => {
    render(<AlertFeed institutionId="inst-1" locale="es" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    expect(screen.getByText('Alertas')).toBeInTheDocument();
    // Check Spanish finding text appears
    expect(screen.getByText('LCR por debajo del umbral minimo')).toBeInTheDocument();
  });

  it('renders Spanish severity labels', async () => {
    render(<AlertFeed institutionId="inst-1" locale="es" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    expect(screen.getByTestId('severity-badge-CRITICAL')).toHaveTextContent('Critica');
    expect(screen.getByTestId('severity-badge-HIGH')).toHaveTextContent('Alta');
  });

  it('renders Spanish empty state', async () => {
    listAlertsMock.mockResolvedValue([]);

    render(<AlertFeed institutionId="inst-1" locale="es" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No hay alertas para mostrar')).toBeInTheDocument();
  });

  // ─── Metric display ──────────────────────────────────────────────────

  it('renders metric value and threshold', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    const metrics = screen.getAllByTestId('alert-metric');
    // CRITICAL alert: Liquidity Coverage Ratio: 85 > 100 threshold
    expect(metrics[0]).toHaveTextContent('Liquidity Coverage Ratio');
    expect(metrics[0]).toHaveTextContent('85');
    expect(metrics[0]).toHaveTextContent('100');
  });

  // ─── Status indicators ────────────────────────────────────────────────

  it('renders correct status dots', async () => {
    render(<AlertFeed institutionId="inst-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    // We should have OPEN, ACKNOWLEDGED, and RESOLVED status dots
    const openDots = screen.getAllByTestId('status-dot-OPEN');
    expect(openDots.length).toBe(2); // CRITICAL and HIGH alerts are OPEN

    const ackDots = screen.getAllByTestId('status-dot-ACKNOWLEDGED');
    expect(ackDots.length).toBe(1);

    const resolvedDots = screen.getAllByTestId('status-dot-RESOLVED');
    expect(resolvedDots.length).toBe(1);
  });

  // ─── Loading state ────────────────────────────────────────────────────

  it('shows loading spinner initially', () => {
    listAlertsMock.mockReturnValue(new Promise(() => {})); // never resolves

    render(<AlertFeed institutionId="inst-1" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // ─── Filters hidden when showFilters=false ────────────────────────────

  it('hides filter bar when showFilters is false', async () => {
    render(<AlertFeed institutionId="inst-1" showFilters={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-feed')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('alert-filter-bar')).not.toBeInTheDocument();
  });
});
