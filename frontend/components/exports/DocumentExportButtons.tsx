'use client';

import { Download, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useDocumentExports } from '@/hooks/useDocumentExports';
import {
  DocumentExportKind,
  DocumentExportManifest,
  groupLanguages,
  labelForDocumentKind,
} from '@/lib/document-exports';
import { useTranslation } from '@/lib/i18n';

interface DocumentExportButtonsProps {
  manifestPath: string;
  kinds?: DocumentExportKind[];
  compact?: boolean;
  className?: string;
  showMeta?: boolean;
}

function manifestComparator(a: DocumentExportManifest, b: DocumentExportManifest) {
  if (a.kind === b.kind) {
    return a.language.localeCompare(b.language);
  }
  return a.kind.localeCompare(b.kind);
}

export function DocumentExportButtons({
  manifestPath,
  kinds,
  compact = false,
  className = '',
  showMeta = false,
}: DocumentExportButtonsProps) {
  const { locale } = useTranslation();
  const { manifests, readyManifests, loading, error, downloadingId, refresh, download } =
    useDocumentExports(manifestPath, { enabled: Boolean(manifestPath) });

  const filtered = useMemo(() => {
    const source = readyManifests
      .filter((manifest) => (kinds ? kinds.includes(manifest.kind) : true))
      .sort(manifestComparator);
    return source;
  }, [kinds, readyManifests]);

  const generatedOn = filtered.find((manifest) => manifest.generatedAt)?.generatedAt;
  const availableLanguages = groupLanguages(filtered);

  if (!manifestPath) {
    return null;
  }

  return (
    <div className={className}>
      {showMeta && filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          {generatedOn && (
            <span>
              {locale === 'en' ? 'Generated on' : 'Generado el'}{' '}
              {new Date(generatedOn).toLocaleDateString(
                locale === 'en' ? 'en-US' : 'es-PR',
              )}
            </span>
          )}
          {availableLanguages.length > 0 && (
            <span>
              {locale === 'en' ? 'Available languages' : 'Idiomas disponibles'}:{' '}
              {availableLanguages.join(' / ').toUpperCase()}
            </span>
          )}
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'mt-2'}`}>
        {filtered.map((manifest) => {
          const active = downloadingId === manifest.id;
          const baseLabel = labelForDocumentKind(
            manifest.kind,
            locale === 'en' ? 'en' : 'es',
          );
          const label =
            availableLanguages.length > 1
              ? `${baseLabel} (${manifest.language.toUpperCase()})`
              : baseLabel;
          return (
            <button
              key={manifest.id}
              onClick={() => void download(manifest)}
              disabled={loading || active}
              className={
                compact
                  ? 'inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50'
                  : 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
              }
            >
              {active ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {label}
            </button>
          );
        })}

        {filtered.length === 0 && loading && (
          <div className="text-xs text-slate-500">
            {locale === 'en' ? 'Loading documents...' : 'Cargando documentos...'}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <span>{error}</span>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 font-medium underline"
          >
            <RefreshCw className="h-3 w-3" />
            {locale === 'en' ? 'Retry' : 'Reintentar'}
          </button>
        </div>
      )}

      {!loading && manifests.length > 0 && filtered.length === 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {locale === 'en' ? 'No documents ready for review yet.' : 'No hay documentos listos para revision todavia.'}
        </div>
      )}
    </div>
  );
}

export default DocumentExportButtons;
