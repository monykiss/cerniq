'use client';

import { useMemo, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

interface Alert {
  readonly id: string;
  readonly severity: Severity;
  readonly alertTextEs: string;
  readonly alertTextEn: string;
  readonly affectedItems: readonly string[];
  readonly recommendedAction: string;
  readonly readAt: string | null;
  readonly dismissedAt: string | null;
  readonly createdAt: string;
}

type AlertsResponse = readonly Alert[];

const SEV: Record<Severity, { bg: string; text: string; border: string; dot: string }> = {
  HIGH:   { bg: 'bg-rose-50',  text: 'text-rose-700',  border: 'border-rose-200',  dot: 'bg-rose-500' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  LOW:    { bg: 'bg-sky-50',   text: 'text-sky-700',   border: 'border-sky-200',   dot: 'bg-sky-500' },
};

function validateAlerts(raw: unknown): AlertsResponse {
  if (!Array.isArray(raw)) throw new Error('Alerts response must be an array');
  return raw as AlertsResponse;
}

/**
 * D1 (never silent zeros, SESSION_HANDOFF §1): NO `getDemo` fallback is
 * supplied. This is a regulatory-publication feed — an examiner/board reader
 * must never see a fabricated "sample" COSSEC/OCIF/NCUA alert. The backend
 * `GET /api/alm/{id}/alerts` returns the institution's real `InstitutionAlert`
 * rows (an array). An empty array is an HONEST "no pending alerts" state — NOT
 * data_unavailable — and renders the neutral empty panel below. A genuine
 * network / 5xx error renders <AlmPage>'s error screen (Retry), never a
 * fabricated sample. The former getDemo() invented 3 circular/guidance alerts
 * with relative dates that a reader took as their cooperativa's real feed.
 * Removed 2026-06-08.
 */

function AlertsContent({ data }: { data: AlertsResponse }) {
  const { locale } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');

  const filtered = useMemo(
    () => data.filter((a) => (filter === 'unread' ? !a.readAt && !a.dismissedAt : true)),
    [data, filter],
  );

  const unreadCount = data.filter((a) => !a.readAt && !a.dismissedAt).length;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'total',     label: locale === 'es' ? 'Total'       : 'Total Alerts', value: data.length, unit: 'count' },
    { key: 'unread',    label: locale === 'es' ? 'No Leídas'   : 'Unread',       value: unreadCount, unit: 'count' },
    { key: 'high',      label: 'HIGH',                                           value: data.filter((a) => a.severity === 'HIGH').length,   unit: 'count' },
    { key: 'medium',    label: 'MEDIUM',                                         value: data.filter((a) => a.severity === 'MEDIUM').length, unit: 'count' },
    { key: 'low',       label: 'LOW',                                            value: data.filter((a) => a.severity === 'LOW').length,    unit: 'count' },
  ], [data, unreadCount, locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Filter toggle */}
      <div className="flex gap-1">
        {(['unread', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === f ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {f === 'unread' ? (locale === 'es' ? 'No Leídas' : 'Unread') : (locale === 'es' ? 'Todas' : 'All')}
          </button>
        ))}
      </div>

      {/* Alerts list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
          <Check className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
          <p className="text-sm text-slate-500">
            {locale === 'es' ? 'No hay alertas pendientes.' : 'No pending alerts.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => {
            const sev = SEV[alert.severity] ?? SEV.MEDIUM;
            return (
              <div key={alert.id} className={`rounded-xl border p-4 ${sev.bg} ${sev.border} ${alert.readAt ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <Bell className="h-3 w-3 text-slate-400" aria-hidden />
                      <span className={`text-[10px] font-bold uppercase ${sev.text}`}>{alert.severity}</span>
                      <span className="text-[10px] text-slate-400">{new Date(alert.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-800">
                      {locale === 'es' ? alert.alertTextEs : alert.alertTextEn || alert.alertTextEs}
                    </p>
                    {alert.affectedItems.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {alert.affectedItems.map((item) => (
                          <span key={item} className="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 text-[10px] text-slate-600">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs italic text-slate-600">→ {alert.recommendedAction}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!alert.readAt ? (
                      <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:text-emerald-600" aria-label={locale === 'es' ? 'Marcar como leída' : 'Mark as read'}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {!alert.dismissedAt ? (
                      <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:text-rose-600" aria-label={locale === 'es' ? 'Descartar' : 'Dismiss'}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function AlertsPage() {
  return (
    <AlmPage<AlertsResponse>
      slug="alerts"
      iconTint="rose"
      validate={validateAlerts}
    >
      {(data) => <AlertsContent data={data} />}
    </AlmPage>
  );
}
