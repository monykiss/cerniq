'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentExportManifest,
  downloadDocumentExport,
  fetchDocumentExports,
} from '@/lib/document-exports';

interface UseDocumentExportsOptions {
  enabled?: boolean;
}

export function useDocumentExports(
  manifestPath?: string,
  options: UseDocumentExportsOptions = {},
) {
  const enabled = options.enabled ?? true;
  const [manifests, setManifests] = useState<DocumentExportManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!manifestPath || !enabled) {
      setManifests([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextManifests = await fetchDocumentExports(manifestPath);
      setManifests(nextManifests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [enabled, manifestPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = useCallback(async (manifest: DocumentExportManifest) => {
    setDownloadingId(manifest.id);
    setError(null);
    try {
      await downloadDocumentExport(manifest);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to download document',
      );
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const readyManifests = useMemo(
    () => manifests.filter((manifest) => manifest.status === 'ready'),
    [manifests],
  );

  return {
    manifests,
    readyManifests,
    loading,
    error,
    downloadingId,
    refresh,
    download,
  };
}
