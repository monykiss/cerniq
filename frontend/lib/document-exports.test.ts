import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadDocumentExport,
  fetchDocumentExports,
  type DocumentExportManifest,
} from './document-exports';

describe('document-exports', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
    localStorage.clear();
    fetchMock.mockReset();
  });

  it('sends x-admin-key for admin manifest requests', async () => {
    sessionStorage.setItem('cerniq_admin_key', 'admin-secret');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await fetchDocumentExports('/admin/api/prospects/prospect-1/dossier/sample-report/exports');

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/api/prospects/prospect-1/dossier/sample-report/exports',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-key': 'admin-secret' }),
      }),
    );
  });

  it('sends x-admin-key for admin binary downloads', async () => {
    sessionStorage.setItem('cerniq_admin_key', 'admin-secret');
    const clickMock = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      click: clickMock,
      set href(_value: string) {},
      set download(_value: string) {},
    } as unknown as HTMLAnchorElement);
    const appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node) => node);
    const removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation((node) => node);
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
      headers: new Headers(),
    });

    const manifest: DocumentExportManifest = {
      id: 'sample_report:prospect-1:es',
      kind: 'sample_report',
      language: 'es',
      audience: 'sample',
      filename: 'sample-report.pdf',
      mimeType: 'application/pdf',
      status: 'ready',
      downloadUrl: '/admin/api/prospects/prospect-1/dossier/sample-report?lang=es',
      generatedAt: null,
      expiresAt: null,
      watermark: null,
      sourceInstitutionId: null,
      sourceJobId: null,
    };

    await downloadDocumentExport(manifest);

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/api/prospects/prospect-1/dossier/sample-report?lang=es',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-key': 'admin-secret' }),
      }),
    );

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});
