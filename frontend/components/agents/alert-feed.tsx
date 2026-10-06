'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { listAlerts, ackAlert } from '@/lib/agents-api';
import type { AgentAlertRecord, Severity, AlertStatus, AgentId } from '@/types/agents';
import { AGENT_LABEL } from '@/types/agents';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AlertFeedProps {
  institutionId: string;
  maxItems?: number;
  showFilters?: boolean;
  locale?: 'en' | 'es';
}

type SeverityFilter = Severity | 'ALL';
type StatusFilter = AlertStatus | 'ALL';

// ─── i18n helpers ───────────────────────────────────────────────────────────

const i18n = {
  en: {
    title: 'Alert Feed',
    empty: 'No alerts to display',
    emptyFiltered: 'No alerts match the current filters',
    severity: 'Severity',
    agent: 'Agent',
    status: 'Status',
    all: 'All',
    acknowledge: 'Acknowledge',
    resolve: 'Resolve',
    viewDetails: 'View Details',
    threshold: 'threshold',
    OPEN: 'Open',
    ACKNOWLEDGED: 'Acknowledged',
    RESOLVED: 'Resolved',
    SUPPRESSED: 'Suppressed',
    CRITICAL: 'Critical',
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
  },
  es: {
    title: 'Alertas',
    empty: 'No hay alertas para mostrar',
    emptyFiltered: 'Ninguna alerta coincide con los filtros',
    severity: 'Severidad',
    agent: 'Agente',
    status: 'Estado',
    all: 'Todos',
    acknowledge: 'Reconocer',
    resolve: 'Resolver',
    viewDetails: 'Ver Detalles',
    threshold: 'umbral',
    OPEN: 'Abierta',
    ACKNOWLEDGED: 'Reconocida',
    RESOLVED: 'Resuelta',
    SUPPRESSED: 'Suprimida',
    CRITICAL: 'Critica',
    HIGH: 'Alta',
    MEDIUM: 'Media',
    LOW: 'Baja',
  },
} as const;

// ─── Relative time formatting ───────────────────────────────────────────────

function relativeTime(dateStr: string, locale: 'en' | 'es'): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) {
    return locale === 'es' ? 'ahora' : 'just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return locale === 'es'
      ? `hace ${diffMinutes}m`
      : `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return locale === 'es'
      ? `hace ${diffHours}h`
      : `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return locale === 'es'
      ? `hace ${diffDays}d`
      : `${diffDays}d ago`;
  }

  return new Date(dateStr).toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ─── Severity badge ─────────────────────────────────────────────────────────

const severityStyles: Record<Severity, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW: 'bg-sky-100 text-sky-700 border-sky-200',
};

function SeverityBadge({
  severity,
  locale,
}: {
  severity: Severity;
  locale: 'en' | 'es';
}) {
  const t = i18n[locale];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${severityStyles[severity]}`}
      data-testid={`severity-badge-${severity}`}
    >
      {t[severity]}
    </span>
  );
}

// ─── Status dot ─────────────────────────────────────────────────────────────

const statusDotColor: Record<AlertStatus, string> = {
  OPEN: 'bg-rose-500',
  ACKNOWLEDGED: 'bg-amber-500',
  RESOLVED: 'bg-emerald-500',
  SUPPRESSED: 'bg-slate-400',
};

function StatusIndicator({
  status,
  locale,
}: {
  status: AlertStatus;
  locale: 'en' | 'es';
}) {
  const t = i18n[locale];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
      <span
        className={`inline-block h-2 w-2 rounded-full ${statusDotColor[status]}`}
        data-testid={`status-dot-${status}`}
      />
      {t[status]}
    </span>
  );
}

// ─── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  severityFilter,
  setSeverityFilter,
  statusFilter,
  setStatusFilter,
  agentFilter,
  setAgentFilter,
  availableAgents,
  locale,
}: {
  severityFilter: SeverityFilter;
  setSeverityFilter: (v: SeverityFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  agentFilter: string;
  setAgentFilter: (v: string) => void;
  availableAgents: string[];
  locale: 'en' | 'es';
}) {
  const t = i18n[locale];
  const selectClass =
    'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400';

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5"
      data-testid="alert-filter-bar"
    >
      {/* Severity filter */}
      <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t.severity}
        <select
          className={selectClass}
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
          aria-label={t.severity}
        >
          <option value="ALL">{t.all}</option>
          <option value="CRITICAL">{t.CRITICAL}</option>
          <option value="HIGH">{t.HIGH}</option>
          <option value="MEDIUM">{t.MEDIUM}</option>
          <option value="LOW">{t.LOW}</option>
        </select>
      </label>

      {/* Agent filter */}
      <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t.agent}
        <select
          className={selectClass}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          aria-label={t.agent}
        >
          <option value="ALL">{t.all}</option>
          {availableAgents.map((a) => (
            <option key={a} value={a}>
              {AGENT_LABEL[a as AgentId] ?? a}
            </option>
          ))}
        </select>
      </label>

      {/* Status filter */}
      <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t.status}
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label={t.status}
        >
          <option value="ALL">{t.all}</option>
          <option value="OPEN">{t.OPEN}</option>
          <option value="ACKNOWLEDGED">{t.ACKNOWLEDGED}</option>
          <option value="RESOLVED">{t.RESOLVED}</option>
        </select>
      </label>
    </div>
  );
}

// ─── Alert row ──────────────────────────────────────────────────────────────

function AlertRow({
  alert,
  locale,
  onAcknowledge,
  onResolve,
}: {
  alert: AgentAlertRecord;
  locale: 'en' | 'es';
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const t = i18n[locale];
  const finding = locale === 'es' ? alert.findingEs : alert.finding;

  // Derive agent name from the runId prefix or category — the alert record
  // doesn't carry agentId directly, so we map the category.
  const agentName = categoryToAgentLabel(alert.category);

  return (
    <div
      className="border-b border-slate-50 px-4 py-3 hover:bg-slate-25 transition-colors last:border-b-0"
      data-testid="alert-row"
    >
      {/* Top line: severity badge + agent name + timestamp */}
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityBadge severity={alert.severity} locale={locale} />
        <span className="text-xs font-semibold text-slate-700">{agentName}</span>
        <span className="ml-auto text-[11px] text-slate-400" data-testid="alert-timestamp">
          {relativeTime(alert.createdAt, locale)}
        </span>
      </div>

      {/* Finding */}
      <p className="mt-1.5 text-sm text-slate-700 leading-snug">{finding}</p>

      {/* Metric + threshold */}
      <p className="mt-1 text-xs text-slate-500 font-mono" data-testid="alert-metric">
        {alert.metric}: {formatMetricValue(alert.currentValue)}{' '}
        {'>'} {formatMetricValue(alert.threshold)} {t.threshold}
      </p>

      {/* Status + actions */}
      <div className="mt-2 flex items-center gap-3">
        <StatusIndicator status={alert.status} locale={locale} />
        <div className="ml-auto flex items-center gap-2">
          {alert.status === 'OPEN' && (
            <button
              type="button"
              onClick={() => onAcknowledge(alert.id)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
            >
              {t.acknowledge}
            </button>
          )}
          {(alert.status === 'OPEN' || alert.status === 'ACKNOWLEDGED') && (
            <button
              type="button"
              onClick={() => onResolve(alert.id)}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 shadow-sm hover:bg-emerald-100 transition-colors"
            >
              {t.resolve}
            </button>
          )}
          <a
            href={`/agents/alerts/${alert.id}`}
            className="text-[11px] font-medium text-sky-600 hover:text-sky-700 hover:underline"
          >
            {t.viewDetails}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatMetricValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

function categoryToAgentLabel(category: string): string {
  const map: Record<string, string> = {
    liquidity: 'Risk Monitor',
    rate_risk: 'Risk Monitor',
    capital: 'Capital Optimizer',
    credit: 'Risk Monitor',
    concentration: 'Risk Monitor',
    deposit_flows: 'Deposit Strategy',
    peer_standing: 'Peer Intelligence',
    camel_drift: 'Risk Monitor',
  };
  return map[category] ?? 'Risk Monitor';
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({
  hasFilters,
  locale,
}: {
  hasFilters: boolean;
  locale: 'en' | 'es';
}) {
  const t = i18n[locale];
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-center"
      data-testid="alert-empty-state"
    >
      <svg
        className="h-10 w-10 text-slate-300"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p className="mt-3 text-sm text-slate-500">
        {hasFilters ? t.emptyFiltered : t.empty}
      </p>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function AlertFeed({
  institutionId,
  maxItems = 50,
  showFilters = true,
  locale = 'en',
}: AlertFeedProps) {
  const [alerts, setAlerts] = useState<AgentAlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');

  // ─── Fetch ──────────────────────────────────────────────────────────────

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await listAlerts(institutionId, { limit: maxItems });
      setAlerts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [institutionId, maxItems]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      try {
        const updated = await ackAlert(institutionId, alertId, {
          status: 'ACKNOWLEDGED',
        });
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? updated : a)),
        );
      } catch {
        // Silently fail — user can retry
      }
    },
    [institutionId],
  );

  const handleResolve = useCallback(
    async (alertId: string) => {
      try {
        const updated = await ackAlert(institutionId, alertId, {
          status: 'RESOLVED',
        });
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? updated : a)),
        );
      } catch {
        // Silently fail — user can retry
      }
    },
    [institutionId],
  );

  // ─── Derived data ───────────────────────────────────────────────────────

  const availableAgents = useMemo(() => {
    const agents = new Set(alerts.map((a) => categoryToAgentLabel(a.category)));
    return [...agents].sort();
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    let result = [...alerts];

    if (severityFilter !== 'ALL') {
      result = result.filter((a) => a.severity === severityFilter);
    }
    if (statusFilter !== 'ALL') {
      result = result.filter((a) => a.status === statusFilter);
    }
    if (agentFilter !== 'ALL') {
      result = result.filter(
        (a) => categoryToAgentLabel(a.category) === agentFilter,
      );
    }

    // Sort newest first
    result.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return result.slice(0, maxItems);
  }, [alerts, severityFilter, statusFilter, agentFilter, maxItems]);

  const hasActiveFilters =
    severityFilter !== 'ALL' || statusFilter !== 'ALL' || agentFilter !== 'ALL';

  // ─── Render ─────────────────────────────────────────────────────────────

  const t = i18n[locale];

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
          <span className="sr-only">Loading alerts...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
      data-testid="alert-feed"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{t.title}</h2>
        {alerts.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {filteredAlerts.length}
          </span>
        )}
      </div>

      {/* Filters */}
      {showFilters && alerts.length > 0 && (
        <FilterBar
          severityFilter={severityFilter}
          setSeverityFilter={setSeverityFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          agentFilter={agentFilter}
          setAgentFilter={setAgentFilter}
          availableAgents={availableAgents}
          locale={locale}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Alert list */}
      <div className="max-h-[600px] overflow-y-auto">
        {filteredAlerts.length === 0 ? (
          <EmptyState hasFilters={hasActiveFilters} locale={locale} />
        ) : (
          filteredAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              locale={locale}
              onAcknowledge={handleAcknowledge}
              onResolve={handleResolve}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Re-export utility for notification center to use
export { relativeTime, severityStyles, categoryToAgentLabel, i18n as alertI18n };
