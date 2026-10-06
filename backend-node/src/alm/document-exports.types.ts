export type DocumentExportKind =
  | 'alm_report'
  | 'sample_report'
  | 'alco_pack'
  | 'preview_report';

export type DocumentExportAudience = 'internal' | 'external' | 'sample';

export type DocumentExportStatus =
  | 'ready'
  | 'processing'
  | 'failed'
  | 'unavailable';

export interface DocumentExportManifest {
  id: string;
  kind: DocumentExportKind;
  language: 'en' | 'es';
  audience: DocumentExportAudience;
  filename: string;
  mimeType: string;
  status: DocumentExportStatus;
  downloadUrl: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  watermark: string | null;
  sourceInstitutionId: string | null;
  sourceJobId: string | null;
}

export interface GeneratedDocumentExport {
  manifest: DocumentExportManifest;
  buffer: Buffer;
}
