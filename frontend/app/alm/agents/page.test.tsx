import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import AgentsPage from './page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/alm/agents',
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: () => [] }),
}));

const mockListRuns = vi.fn();
const mockListAlerts = vi.fn();
const mockAckAlert = vi.fn();

vi.mock('@/lib/agents-api', () => ({
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  listAlerts: (...args: unknown[]) => mockListAlerts(...args),
  ackAlert: (...args: unknown[]) => mockAckAlert(...args),
  agentStreamUrl: () => '/mock/stream',
}));

vi.mock('@/hooks/useAgentStream', () => ({
  useAgentStream: () => ({
    events: [],
    lastEvent: null,
    isConnected: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: () => ({
    selectedId: 'inst-1',
    institution: { id: 'inst-1', name: 'Demo CU' },
    institutions: [],
    loading: false,
  }),
}));

vi.mock('lucide-react', () => {
  const Icon = ({ ...props }: Record<string, unknown>) => <svg {...props} />;
  return { Bell: Icon, CheckCircle2: Icon, AlertTriangle: Icon };
});

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders run activity feed with data', async () => {
    mockListRuns.mockResolvedValue({
      runs: [{
        id: 'run-1', agentId: 'ALM_DECISION', status: 'SUCCEEDED',
        triggerKind: 'API', durationMs: 32000, costUsdCents: 450,
        createdAt: '2026-04-15T12:00:00Z',
      }],
    });
    mockListAlerts.mockResolvedValue([]);

    render(<AgentsPage />);
    expect(await screen.findByText('Agent Activity')).toBeInTheDocument();
    expect(await screen.findByText('ALM Decision')).toBeInTheDocument();
  });

  it('renders open alerts with ack buttons', async () => {
    mockListRuns.mockResolvedValue({ runs: [] });
    mockListAlerts.mockResolvedValue([
      {
        id: 'alert-1', runId: 'run-1', institutionId: 'inst-1',
        category: 'liquidity', severity: 'CRITICAL', status: 'OPEN',
        metric: 'LCR', currentValue: 102, threshold: 105, delta: -3,
        finding: 'LCR below 105%', findingEs: 'LCR bajo 105%',
        recommendation: 'Increase HQLA', regulatoryRef: 'Basel III LCR',
        deadline: '2026-05-01', createdAt: '2026-04-15T12:00:00Z',
        dedupKey: 'dk-1', acknowledgedAt: null, acknowledgedBy: null,
        resolutionNote: null, notifiedAt: null,
      },
    ]);

    render(<AgentsPage />);
    expect(await screen.findByText('Open Alerts')).toBeInTheDocument();
    expect(await screen.findByText('LCR below 105%')).toBeInTheDocument();
    expect(await screen.findByText('Ack')).toBeInTheDocument();
  });

  it('shows empty message when no runs', async () => {
    mockListRuns.mockResolvedValue({ runs: [] });
    mockListAlerts.mockResolvedValue([]);

    render(<AgentsPage />);
    expect(await screen.findByText('No recent runs')).toBeInTheDocument();
  });
});
