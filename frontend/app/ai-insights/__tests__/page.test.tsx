import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Page from '../page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/ai-insights',
}));

// Mock i18n — return English locale
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: (k: string) => k, setLocale: vi.fn() }),
}));

// Mock ChatMessage component — render content visibly
vi.mock('@/components/wave03/chat-message', () => ({
  ChatMessage: ({ role, content, streaming }: { role: string; content: string; streaming?: boolean }) => (
    <div data-testid={`chat-message-${role}`}>
      {streaming ? <span>Loading...</span> : <span>{content}</span>}
    </div>
  ),
}));

// Mock fetch for API calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: false,
  json: async () => ([]),
});
global.fetch = mockFetch;

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
}
(global as unknown as Record<string, unknown>).WebSocket = MockWebSocket;

describe('AI Insights Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: false, json: async () => ([]) });
  });

  it('renders the page heading (AI Advisor)', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('AI Advisor')).toBeInTheDocument();
    });
  });

  it('shows the session list sidebar with conversation titles', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Conversations')).toBeInTheDocument();
    });
    expect(screen.getByText('Liquidity Risk Review')).toBeInTheDocument();
    expect(screen.getByText('NII Sensitivity Analysis')).toBeInTheDocument();
    expect(screen.getByText('COSSEC Exam Prep')).toBeInTheDocument();
  });

  it('shows the chat input area with placeholder text', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('Message')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Type your question...')).toBeInTheDocument();
  });

  it('shows the institution selector with demo institutions', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('Select institution')).toBeInTheDocument();
    });
    const select = screen.getByLabelText('Select institution');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Cooperativa de Ahorro Caguas')).toBeInTheDocument();
    expect(screen.getByText('ACACIA Federal Credit Union')).toBeInTheDocument();
  });

  it('shows the language selector with EN/ES/Both options', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('Response language')).toBeInTheDocument();
    });
    const langSelect = screen.getByLabelText('Response language');
    expect(langSelect).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(screen.getByText('ES')).toBeInTheDocument();
    expect(screen.getByText('Both')).toBeInTheDocument();
  });

  it('shows loading skeleton initially before data resolves', () => {
    // Make fetch hang (never resolve) so pageLoading stays true
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<Page />);
    expect(screen.getByText('Loading AI Advisor...')).toBeInTheDocument();
  });

  it('renders chat messages from demo data after loading', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('AI Advisor')).toBeInTheDocument();
    });
    // Demo messages should appear via mocked ChatMessage component
    expect(screen.getByText(/What is our current liquidity position/)).toBeInTheDocument();
    expect(screen.getByText(/Liquidity Coverage Ratio/)).toBeInTheDocument();
  });

  it('shows the send button', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('Send')).toBeInTheDocument();
    });
  });

  it('shows the new conversation button', async () => {
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByLabelText('New conversation')).toBeInTheDocument();
    });
  });
});
