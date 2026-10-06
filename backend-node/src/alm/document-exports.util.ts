import {
  DocumentExportAudience,
  DocumentExportKind,
  DocumentExportManifest,
  DocumentExportStatus,
} from './document-exports.types';

const PDF_MIME = 'application/pdf';

const KIND_PREFIX: Record<DocumentExportKind, string> = {
  alm_report: 'alm-report',
  sample_report: 'sample-document',
  alco_pack: 'board-package',
  preview_report: 'preview-document',
};

const DEFAULT_WATERMARKS: Partial<Record<DocumentExportKind, string>> = {
  sample_report: 'SAMPLE DOCUMENT — FOR REVIEW PURPOSES ONLY',
  preview_report: 'PREVIEW DOCUMENT — FOR REVIEW PURPOSES ONLY',
};

export function sanitizeFilenamePart(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\u0020-\u007E]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'cerniq-document'
  );
}

export function formatDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function buildDocumentFilename(params: {
  kind: DocumentExportKind;
  institutionName?: string | null;
  sourceLabel?: string | null;
  language: 'en' | 'es';
  generatedAt?: Date | string | null;
  extension?: string;
}): string {
  const extension = params.extension || 'pdf';
  const prefix = KIND_PREFIX[params.kind];
  const namePart = sanitizeFilenamePart(
    params.institutionName || params.sourceLabel || 'cerniq',
  );
  const langPart = params.language;
  const datePart = formatDateStamp(
    params.generatedAt ? new Date(params.generatedAt) : new Date(),
  );
  return `${prefix}-${namePart}-${langPart}-${datePart}.${extension}`;
}

export function buildManifestId(
  kind: DocumentExportKind,
  sourceKey: string,
  language: 'en' | 'es',
): string {
  return `${kind}:${sourceKey}:${language}`;
}

export function getDefaultWatermark(kind: DocumentExportKind): string | null {
  return DEFAULT_WATERMARKS[kind] || null;
}

export function createPdfManifest(params: {
  id: string;
  kind: DocumentExportKind;
  language: 'en' | 'es';
  audience: DocumentExportAudience;
  status: DocumentExportStatus;
  downloadUrl: string | null;
  sourceInstitutionId?: string | null;
  sourceJobId?: string | null;
  institutionName?: string | null;
  sourceLabel?: string | null;
  generatedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  watermark?: string | null;
}): DocumentExportManifest {
  return {
    id: params.id,
    kind: params.kind,
    language: params.language,
    audience: params.audience,
    filename: buildDocumentFilename({
      kind: params.kind,
      institutionName: params.institutionName,
      sourceLabel: params.sourceLabel,
      language: params.language,
      generatedAt: params.generatedAt,
    }),
    mimeType: PDF_MIME,
    status: params.status,
    downloadUrl: params.downloadUrl,
    generatedAt: params.generatedAt
      ? new Date(params.generatedAt).toISOString()
      : null,
    expiresAt: params.expiresAt
      ? new Date(params.expiresAt).toISOString()
      : null,
    watermark:
      params.watermark === undefined
        ? getDefaultWatermark(params.kind)
        : params.watermark,
    sourceInstitutionId: params.sourceInstitutionId ?? null,
    sourceJobId: params.sourceJobId ?? null,
  };
}

export function buildPdfResponseHeaders(
  manifest: DocumentExportManifest,
  contentLength: number,
): Record<string, string | number> {
  return {
    'Content-Type': manifest.mimeType,
    'Content-Disposition': `attachment; filename="${manifest.filename}"`,
    'Content-Length': contentLength,
    'X-Cerniq-Document-Kind': manifest.kind,
    'X-Cerniq-Document-Language': manifest.language,
    'X-Cerniq-Document-Audience': manifest.audience,
  };
}
