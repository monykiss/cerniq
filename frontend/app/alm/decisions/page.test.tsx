import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import DecisionsPage from './page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/alm/decisions',
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
const mockGetRunTrace = vi.fn();
const mockTriggerAgentRun = vi.fn();

vi.mock('@/lib/agents-api', () => ({
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  getRunTrace: (...args: unknown[]) => mockGetRunTrace(...args),
  triggerAgentRun: (...args: unknown[]) => mockTriggerAgentRun(...args),
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
  return {
    Play: Icon, ChevronDown: Icon, ChevronRight: Icon,
    Download: Icon, Globe: Icon,
  };
});

const MOCK_OUTPUT = {
  agentId: 'alm_decision',
  version: '2.0',
  runId: 'run-1',
  institutionId: 'inst-1',
  timestamp: '2026-04-15T12:00:00Z',
  language: 'bilingual' as const,
  healthSnapshot: {
    overall: 62, capital: 75, liquidity: 80, rateRisk: 45,
    credit: 70, concentration: 65, label: 'SATISFACTORY' as const, trend: 'stable' as const,
  },
  topRisks: [
    {
      rank: 1, domain: 'Interest Rate Risk', priorityScore: 18,
      severity: 'HIGH' as const, finding: 'NII drops $2.1M at +200bps',
      findingEs: 'NII baja $2.1M a +200bps', dollarImpact: 2100000,
      dollarImpactPct: 6.2, regulatoryRef: '12 CFR 741.3', toolsUsed: ['runFullSwarm'],
    },
  ],
  decisionQueue: [
    {
      priority: 1, action: 'Shift $15M from fixed to variable',
      actionEs: 'Mover $15M de fijo a variable', expectedImpact: '+$840K NII annualized',
      deadline: '60d' as const, owner: 'CFO' as const, regulatoryRef: '12 CFR 741.3',
      status: 'PENDING' as const,
    },
  ],
  brief: 'The institution faces elevated interest rate risk.',
  briefEs: 'La institución enfrenta riesgo de tasa elevado.',
  auditTraceId: 'trace-1',
};

describe('DecisionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders health snapshot and risk table with run data', async () => {
    mockListRuns.mockResolvedValue({
      runs: [{
        id: 'run-1', agentId: 'ALM_DECISION', status: 'SUCCEEDED',
        output: MOCK_OUTPUT, completedAt: '2026-04-15T12:01:00Z',
        durationMs: 32000, createdAt: '2026-04-15T12:00:00Z',
      }],
    });
    mockGetRunTrace.mockResolvedValue([
      { id: 's1', runId: 'run-1', stepNumber: 1, stepKind: 'TOOL_CALL', toolName: 'runFullSwarm', durationMs: 500, createdAt: '2026-04-15T12:00:01Z' },
    ]);

    render(<DecisionsPage />);

    expect(await screen.findByText('Decision Panel')).toBeInTheDocument();
    expect(await screen.findByText('Interest Rate Risk')).toBeInTheDocument();
    expect(await screen.findByText('$2,100,000')).toBeInTheDocument();
    expect(await screen.findByText('12 CFR 741.3')).toBeInTheDocument();
  });

  it('shows empty state when no runs exist', async () => {
    mockListRuns.mockResolvedValue({ runs: [] });

    render(<DecisionsPage />);
    expect(await screen.findByText('No recent analysis')).toBeInTheDocument();
  });

  it('shows Run ALM button', async () => {
    mockListRuns.mockResolvedValue({ runs: [] });

    render(<DecisionsPage />);
    expect(await screen.findByText('Run ALM')).toBeInTheDocument();
  });
});
