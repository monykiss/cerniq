import {
  buildDocumentFilename,
  buildPdfResponseHeaders,
  createPdfManifest,
  sanitizeFilenamePart,
} from './document-exports.util';

describe('document-exports.util', () => {
  it('sanitizes filename parts for enterprise downloads', () => {
    expect(sanitizeFilenamePart('Cooperativa Ejemplo Norte & Co.')).toBe(
      'cooperativa-ejemplo-norte-co',
    );
  });

  it('builds bilingual document filenames', () => {
    expect(
      buildDocumentFilename({
        kind: 'alm_report',
        institutionName: 'Cooperativa Ejemplo Este',
        language: 'es',
        generatedAt: '2026-04-06T00:00:00.000Z',
      }),
    ).toBe('alm-report-cooperativa-ejemplo-este-es-2026-04-06.pdf');
  });

  it('defaults sample and preview watermarks in manifests', () => {
    const manifest = createPdfManifest({
      id: 'sample_report:123:en',
      kind: 'sample_report',
      language: 'en',
      audience: 'sample',
      status: 'ready',
      downloadUrl: '/api/alm/sample-report/123?lang=en',
      sourceLabel: '123',
      generatedAt: '2026-04-06T00:00:00.000Z',
    });

    expect(manifest.watermark).toContain('SAMPLE DOCUMENT');
  });

  it('builds consistent PDF response headers', () => {
    const manifest = createPdfManifest({
      id: 'alm_report:inst-1:en',
      kind: 'alm_report',
      language: 'en',
      audience: 'internal',
      status: 'ready',
      downloadUrl: '/api/alm/inst-1/report?lang=en',
      institutionName: 'Test Institution',
      generatedAt: '2026-04-06T00:00:00.000Z',
      watermark: null,
    });

    expect(buildPdfResponseHeaders(manifest, 1234)).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': expect.stringContaining(manifest.filename),
        'Content-Length': 1234,
        'X-Cerniq-Document-Kind': 'alm_report',
        'X-Cerniq-Document-Language': 'en',
      }),
    );
  });
});
