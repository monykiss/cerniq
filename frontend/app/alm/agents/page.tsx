'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInstitutionId } from '@/lib/hooks/useInstitutionId';
import { useTranslation } from '@/lib/i18n';
import { useAgentStream } from '@/hooks/useAgentStream';
import { listRuns, listAlerts, ackAlert } from '@/lib/agents-api';
import {
  DataTable,
  SkeletonLoader,
  ErrorBanner,
} from '@/components/ui/cerniq';
import type { DataTableColumn } from '@/components/ui/cerniq';
import type {
  AgentRun,
  AgentAlertRecord,
} from '@/types/agents';
import { AGENT_LABEL } from '@/types/agents';
import { Bell, CheckCircle2, AlertTriangle } from 'lucide-react';

const STATUS_DOT: Record<string, string> = {
  QUEUED: 'bg-slate-300',
  RUNNING: 'bg-cyan-400 animate-pulse',
  SUCCEEDED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  CANCELLED: 'bg-slate-300',
  TIMED_OUT: 'bg-amber-500',
};

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'border-rose-300 bg-rose-50 text-rose-800',
  HIGH: 'border-amber-300 bg-amber-50 text-amber-800',
  MEDIUM: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  LOW: 'border-slate-200 bg-slate-50 text-slate-600',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '<1m';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export default function AgentsPage() {
  // Phase-2 layered resolver (see /alm/decisions for rationale).
  const selectedId = useInstitutionId();
  const { locale } = useTranslation();
  const isEs = locale === 'es';

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [alerts, setAlerts] = useState<AgentAlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [runData, alertData] = await Promise.all([
        listRuns(selectedId, { limit: 20 }),
        listAlerts(selectedId, { ack: false }),
      ]);
      setRuns(runData.runs);
      setAlerts(alertData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void loadData(); }, [loadData]);

  useAgentStream({
    institutionId: selectedId || null,
    onEvent: useCallback(() => {
      void loadData();
    }, [loadData]),
  });

  const handleAck = useCallback(async (alertId: string) => {
    if (!selectedId) return;
    await ackAlert(selectedId, alertId);
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, [selectedId]);

  const runColumns: DataTableColumn<AgentRun>[] = useMemo(
    () => [
      {
        key: 'status',
        header: '',
        cell: (r) => <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[r.status] ?? 'bg-slate-300'}`} role="img" aria-label={r.status} />,
        width: '28px',
      },
      {
        key: 'agent',
        header: isEs ? 'Agente' : 'Agent',
        cell: (r) => <span className="font-medium text-xs">{AGENT_LABEL[r.agentId]}</span>,
        width: '140px',
      },
      {
        key: 'status_label',
        header: 'Status',
        cell: (r) => <span className="font-mono text-[10px] text-slate-500">{r.status}</span>,
        width: '80px',
      },
      {
        key: 'trigger',
        header: isEs ? 'Disparador' : 'Trigger',
        cell: (r) => <span className="text-[10px] text-slate-400">{r.triggerKind}</span>,
        width: '70px',
      },
      {
        key: 'duration',
        header: isEs ? 'Duración' : 'Duration',
        cell: (r) => (
          <span className="font-mono text-[11px] text-slate-500">
            {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}
          </span>
        ),
        width: '70px',
        align: 'right',
        numeric: true,
      },
      {
        key: 'cost',
        header: isEs ? 'Costo' : 'Cost',
        cell: (r) => (
          <span className="font-mono text-[10px] text-slate-400">
            {r.costUsdCents != null ? `$${(r.costUsdCents / 100).toFixed(2)}` : '—'}
          </span>
        ),
        width: '60px',
        align: 'right',
        numeric: true,
      },
      {
        key: 'time',
        header: isEs ? 'Hace' : 'Ago',
        cell: (r) => <span className="text-[10px] text-slate-300">{timeAgo(r.createdAt)}</span>,
        width: '50px',
        align: 'right',
      },
    ],
    [isEs],
  );

  if (!selectedId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        {isEs ? 'Seleccione una institución' : 'Select an institution'}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4" role="status" aria-label="Loading agent activity">
        <SkeletonLoader variant="table" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 space-y-2">
        <ErrorBanner error={error} />
        <button
          onClick={() => void loadData()}
          className="text-xs text-cyan-600 hover:underline"
        >
          {isEs ? 'Reintentar' : 'Retry'}
        </button>
      </div>
    );
  }

  const unacked = alerts.filter((a) => a.status === 'OPEN');

  return (
    <div className="space-y-4 p-4" role="main" aria-label="Agent Activity">
      {/* Alert center */}
      {unacked.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-3.5 h-3.5 text-rose-500" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              {isEs ? 'Alertas Abiertas' : 'Open Alerts'}
              <span className="ml-1 text-rose-500">{unacked.length}</span>
            </span>
          </div>
          <div className="space-y-1">
            {unacked.map((a) => (
              <div
                key={a.id}
                className={`flex items-start gap-3 rounded border px-3 py-2 ${SEV_CLS[a.severity] ?? ''}`}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase">{a.severity}</span>
                    <span className="text-[10px] font-mono">{a.metric}</span>
                    <span className="text-[10px] text-slate-400">{a.category}</span>
                  </div>
                  <p className="text-xs leading-tight mt-0.5">
                    {isEs ? a.findingEs : a.finding}
                  </p>
                  {a.regulatoryRef && (
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">{a.regulatoryRef}</p>
                  )}
                </div>
                <button
                  onClick={() => handleAck(a.id)}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-800"
                >
                  <CheckCircle2 className="w-3 h-3" /> Ack
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run activity feed */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
          {isEs ? 'Actividad de Agentes' : 'Agent Activity'}
          <span className="ml-1 text-slate-300">({runs.length})</span>
        </p>
        <DataTable
          columns={runColumns}
          rows={runs}
          rowKey={(r) => r.id}
          emptyMessage={isEs ? 'Sin ejecuciones recientes' : 'No recent runs'}
        />
      </div>
    </div>
  );
}
