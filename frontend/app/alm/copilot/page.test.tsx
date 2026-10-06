import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import CopilotPage from './page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/alm/copilot',
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: () => [] }),
}));

const mockCopilotQuery = vi.fn();

vi.mock('@/lib/agents-api', () => ({
  copilotQuery: (...args: unknown[]) => mockCopilotQuery(...args),
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: () => ({
    selectedId: 'inst-1',
    institution: { id: 'inst-1', name: 'Demo CU' },
    institutions: [],
    loading: false,
  }),
}));

// Passthrough lucide-react rather than a hand-rolled mock — Phase 3 wired
// ScenarioInput into this page, which transitively pulls ~12 additional
// icons. Maintaining a manual allowlist becomes a liability as the page
// grows. The real lucide-react icons are just SVG components; no need
// to stub them.
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

describe('CopilotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state with quick questions', () => {
    render(<CopilotPage />);
    expect(screen.getByText('CFO Copilot')).toBeInTheDocument();
    expect(screen.getByText('What happens at +200bps?')).toBeInTheDocument();
    expect(screen.getByText('What is our LCR vs peers?')).toBeInTheDocument();
  });

  it('renders input field and send button', () => {
    render(<CopilotPage />);
    expect(screen.getByPlaceholderText('Ask CFO Copilot...')).toBeInTheDocument();
  });

  it('sends message and displays response', async () => {
    mockCopilotQuery.mockResolvedValue({
      sessionId: 'session-1',
      message: 'At +200bps, NII drops $2.1M (6.2% of base).',
      toolsCalled: ['runRateShock'],
      followups: [
        { en: 'Run Monte Carlo', es: 'Ejecutar Monte Carlo' },
      ],
    });

    render(<CopilotPage />);

    const input = screen.getByPlaceholderText('Ask CFO Copilot...');
    fireEvent.change(input, { target: { value: 'What happens at +200bps?' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText(/NII drops \$2\.1M/)).toBeInTheDocument();
    expect(await screen.findByText('runRateShock')).toBeInTheDocument();
    expect(await screen.findByText('Run Monte Carlo')).toBeInTheDocument();
  });

  it('renders placeholder text in input', () => {
    render(<CopilotPage />);
    const input = screen.getByPlaceholderText('Ask CFO Copilot...');
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });
});
