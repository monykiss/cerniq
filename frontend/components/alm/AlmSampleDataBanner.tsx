'use client';

import { useTranslation } from '@/lib/i18n';

/**
 * AlmSampleDataBanner — the labeled "Sample data" notice.
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): the custom Group-C ALM pages
 * (sofr-exposure, ltp, network, oas) do NOT route through `<AlmPage>`, so they
 * do not get its built-in amber `source === 'demo'` banner for free. When one
 * of them falls back to its `getDemoData()` sample on a genuine network / 5xx
 * error, it MUST say so — an UNlabeled demo is itself a quiet fabrication.
 *
 * This is the same markup `<AlmPage>` renders inline (see AlmPage.tsx) so the
 * demo-labeling UX is identical whether a page is AlmPage-based or custom.
 *
 * Policy boundary: the demo is the genuine network/500 fallback ONLY. A
 * backend `data_unavailable` shell (a 200-OK with null numerics + gaps[]) is
 * NOT an error — it bypasses the demo entirely and renders
 * `<AlmDataUnavailable>` instead. See lib/alm/data-shell.ts.
 */

export interface AlmSampleDataBannerProps {
  readonly className?: string;
}

export function AlmSampleDataBanner({ className }: AlmSampleDataBannerProps) {
  const { locale } = useTranslation();
  const es = locale === 'es';

  return (
    <div
      className={
        className ??
        'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'
      }
      role="note"
    >
      <strong>{es ? 'Datos de muestra' : 'Sample data'}</strong>
      {' — '}
      {es
        ? 'Conecte su institución para análisis en vivo.'
        : 'Connect your institution for live analysis.'}
    </div>
  );
}
