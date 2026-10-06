import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ALMProvider, { useALM } from './ALMProvider';

const { getInstitutionsMock, navigationState } = vi.hoisted(() => ({
  getInstitutionsMock: vi.fn(),
  navigationState: { searchParamsValue: '' },
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationState.searchParamsValue),
  usePathname: () => '/alm',
}));

vi.mock('@/lib/api', () => ({
  buildLoginRedirectUrl: vi.fn((pathname: string, search: string) => `/login?returnUrl=${encodeURIComponent(`${pathname}${search}`)}`),
  getApiErrorMessage: vi.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
  isAuthError: vi.fn((error: unknown) => (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as { response?: { status?: number } }).response?.status === 401
  )),
  isPlatformAccessError: vi.fn(() => false),
  apiClient: {
    getInstitutions: getInstitutionsMock,
  },
}));

function Consumer() {
  const { selectedId, setSelectedId, loading, institutions, authRedirecting, bootstrapError } = useALM();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="selectedId">{selectedId}</span>
      <span data-testid="count">{institutions.length}</span>
      <span data-testid="authRedirecting">{String(authRedirecting)}</span>
      <span data-testid="bootstrapError">{bootstrapError || ''}</span>
      <button onClick={() => setSelectedId('inst-2')}>Change</button>
    </div>
  );
}

describe('ALMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.searchParamsValue = '';
    getInstitutionsMock.mockResolvedValue([
      { id: 'inst-1', name: 'Test CU', type: 'credit_union', totalAssets: 100_000_000 },
      { id: 'inst-2', name: 'Second CU', type: 'bank', totalAssets: 250_000_000 },
    ]);
  });

  it('provides context values to children', async () => {
    render(
      <ALMProvider>
        <Consumer />
      </ALMProvider>,
    );

    // Initially loading
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // After fetch resolves, loading becomes false and institutions are available
    await screen.findByText('false');
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('selects the first institution by default when none specified in URL', async () => {
    render(
      <ALMProvider>
        <Consumer />
      </ALMProvider>,
    );

    await screen.findByText('false');
    expect(screen.getByTestId('selectedId').textContent).toBe('inst-1');
  });

  it('updates selectedId and URL when setSelectedId is called', async () => {
    const user = userEvent.setup();
    render(
      <ALMProvider>
        <Consumer />
      </ALMProvider>,
    );

    await screen.findByText('false');
    await user.click(screen.getByRole('button', { name: /change/i }));

    await waitFor(() => {
      expect(screen.getByTestId('selectedId').textContent).toBe('inst-2');
    });
    expect(replaceMock).toHaveBeenCalled();
  });

  it('redirects to login when institution bootstrap is unauthorized', async () => {
    navigationState.searchParamsValue = 'id=inst-1';
    getInstitutionsMock.mockRejectedValueOnce({
      response: { status: 401 },
    });

    render(
      <ALMProvider>
        <Consumer />
      </ALMProvider>,
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login?returnUrl=%2Falm%3Fid%3Dinst-1');
    });
  });

  it('surfaces a blocking bootstrap error for non-auth failures', async () => {
    getInstitutionsMock.mockRejectedValueOnce(new Error('backend offline'));

    render(
      <ALMProvider>
        <Consumer />
      </ALMProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('bootstrapError').textContent).toBe('backend offline');
      expect(screen.getByTestId('count').textContent).toBe('0');
    });
  });
});
