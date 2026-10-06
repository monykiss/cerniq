import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentExportButtons from './DocumentExportButtons';

const fetchMock = vi.fn();
const createObjectUrlMock = vi.fn(() => 'blob:download');
const revokeObjectUrlMock = vi.fn();

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

describe('DocumentExportButtons', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    createObjectUrlMock.mockReset();
    revokeObjectUrlMock.mockReset();
    createObjectUrlMock.mockReturnValue('blob:download');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', URL);
    globalThis.URL.createObjectURL = createObjectUrlMock as typeof URL.createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectUrlMock as typeof URL.revokeObjectURL;
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn(() => 'token-123'),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads manifests and downloads a document through the shared flow', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'alm_report:inst-1:en',
              kind: 'alm_report',
              language: 'en',
              audience: 'internal',
              filename: 'alm-report-test-en-2026-04-06.pdf',
              mimeType: 'application/pdf',
              status: 'ready',
              downloadUrl: '/api/alm/inst-1/report?lang=en',
              generatedAt: '2026-04-06T12:00:00.000Z',
              expiresAt: null,
              watermark: null,
              sourceInstitutionId: 'inst-1',
              sourceJobId: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['pdf-data'], { type: 'application/pdf' }),
        headers: {
          get: () => 'attachment; filename="alm-report-test-en-2026-04-06.pdf"',
        },
      });

    render(
      <DocumentExportButtons manifestPath="/api/alm/inst-1/exports" />,
    );

    const button = await screen.findByRole('button', {
      name: /download report/i,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a retryable error state when manifest loading fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(
      <DocumentExportButtons manifestPath="/api/alm/inst-1/exports" />,
    );

    expect(
      await screen.findByText(/unable to load exports/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
