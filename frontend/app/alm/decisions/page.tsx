'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInstitutionId } from '@/lib/hooks/useInstitutionId';
import { useTranslation } from '@/lib/i18n';
import { useAgentStream } from '@/hooks/useAgentStream';
import { listRuns, triggerAgentRun, getRunTrace } from '@/lib/agents-api';
import {
  MetricStrip,
  DataTable,
  SkeletonLoader,
  ErrorBanner,
} from '@/components/ui/cerniq';
import type { MetricStripItem, DataTableColumn } from '@/components/ui/cerniq';
import type {
  AgentRun,
  ALMDecisionOutput,
  TopRisk,
  DecisionQueueItem,
  AgentAuditStep,
} from '@/types/agents';
import { type AgentStreamEvent } from '@/types/agents';
import { Play, ChevronDown, ChevronRight, Download, Globe } from 'lucide-react';
import HealthScoreWidget from '@/components/alm/health-score-widget';

const SEVERITY_CLS: Record<string, string> = {
  HIGH: 'text-rose-700 bg-rose-50 border-rose-200',
  MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200',
  LOW: 'text-slate-600 bg-slate-50 border-slate-200',
};

const OWNER_CLS: Record<string, string> = {
  CFO: 'text-cyan-700',
  ALM_COMMITTEE: 'text-violet-700',
  BOARD: 'text-rose-700',
};

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMs(ms: number): string {
  return ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function DecisionsPage() {
  // Phase-2 layered resolver: ?institutionId=… URL param wins (for email +
  // Slack deep-links), otherwise falls back to the ALM shell's selector.
  // Returns `string | undefined` — every downstream guard (`if (!selectedId)`)
  // already treats empty-string as absent, so this is a drop-in source swap.
  const selectedId = useInstitutionId();
  const { locale } = useTranslation();
  const isEs = locale === 'es';

  const [run, setRun] = useState<AgentRun | null>(null);
  const [trace, setTrace] = useState<AgentAuditStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadLatest = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const { runs } = await listRuns(selectedId, {
        agentId: 'ALM_DECISION',
        status: 'SUCCEEDED',
        limit: 1,
      });
      const latest = runs[0] ?? null;
      setRun(latest);
      if (latest) {
        const steps = await getRunTrace(selectedId, latest.id);
        setTrace(steps);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);

  useAgentStream({
    institutionId: selectedId || null,
    filter: ['agent:started', 'agent:step', 'agent:completed', 'agent:failed'],
    onEvent: useCallback((e: AgentStreamEvent) => {
      if (e.type === 'agent:step' && 'pct' in e) setProgress(e.pct);
      if (e.type === 'agent:completed' || e.type === 'agent:failed') {
        setTriggering(false);
        loadLatest();
      }
    }, [loadLatest]),
  });

  const handleTrigger = useCallback(async () => {
    if (!selectedId || triggering) return;
    setTriggering(true);
    setProgress(0);
    try {
      await triggerAgentRun(selectedId, {
        agentId: 'ALM_DECISION',
        triggerKind: 'API',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger failed');
      setTriggering(false);
    }
  }, [selectedId, triggering]);

  const output = run?.output as ALMDecisionOutput | null;

  const healthItems: MetricStripItem[] = useMemo(() => {
    if (!output) return [];
    const h = output.healthSnapshot;
    return [
      { label: 'Overall', value: h.overall, tooltip: h.label },
      { label: 'Capital', value: h.capital },
      { label: 'Liquidity', value: h.liquidity },
      { label: 'Rate Risk', value: h.rateRisk },
      { label: 'Credit', value: h.credit },
      { label: 'Concentration', value: h.concentration },
    ];
  }, [output]);

  const riskColumns: DataTableColumn<TopRisk>[] = useMemo(
    () => [
      { key: 'rank', header: '#', cell: (r) => r.rank, width: '40px', align: 'right', numeric: true },
      { key: 'domain', header: isEs ? 'Dominio' : 'Domain', cell: (r) => r.domain, width: '140px' },
      {
        key: 'severity',
        header: isEs ? 'Severidad' : 'Severity',
        cell: (r) => (
          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold border ${SEVERITY_CLS[r.severity] ?? ''}`}>
            {r.severity}
          </span>
        ),
        width: '80px',
      },
      { key: 'score', header: 'PRI', cell: (r) => r.priorityScore, width: '50px', align: 'right', numeric: true, sortValue: (r) => r.priorityScore },
      {
        key: 'finding',
        header: isEs ? 'Hallazgo' : 'Finding',
        cell: (r) => (
          <span className="text-xs leading-tight line-clamp-2">
            {isEs ? r.findingEs : r.finding}
          </span>
        ),
      },
      { key: 'impact', header: '$ Impact', cell: (r) => fmtUsd(r.dollarImpact), width: '110px', align: 'right', numeric: true, sortValue: (r) => r.dollarImpact },
      { key: 'pct', header: '% NII', cell: (r) => `${r.dollarImpactPct.toFixed(1)}%`, width: '70px', align: 'right', numeric: true },
      { key: 'reg', header: 'Reg', cell: (r) => <span className="text-[10px] text-slate-500 font-mono">{r.regulatoryRef}</span>, width: '120px' },
    ],
    [isEs],
  );

  const queueColumns: DataTableColumn<DecisionQueueItem>[] = useMemo(
    () => [
      { key: 'pri', header: '#', cell: (r) => r.priority, width: '36px', align: 'right', numeric: true },
      {
        key: 'action',
        header: isEs ? 'Acción' : 'Action',
        cell: (r) => (
          <span className="text-xs leading-tight">{isEs ? r.actionEs : r.action}</span>
        ),
      },
      { key: 'impact', header: isEs ? 'Impacto' : 'Impact', cell: (r) => r.expectedImpact, width: '180px' },
      {
        key: 'deadline',
        header: isEs ? 'Plazo' : 'Deadline',
        cell: (r) => <span className="font-mono text-[11px]">{r.deadline}</span>,
        width: '60px',
      },
      {
        key: 'owner',
        header: isEs ? 'Dueño' : 'Owner',
        cell: (r) => <span className={`text-xs font-semibold ${OWNER_CLS[r.owner] ?? ''}`}>{r.owner.replace('_', ' ')}</span>,
        width: '110px',
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => (
          <span className="text-[10px] font-semibold text-slate-400">{r.status}</span>
        ),
        width: '70px',
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
      <div className="space-y-4 p-4" role="status" aria-label="Loading decision panel">
        <SkeletonLoader variant="metric" />
        <SkeletonLoader variant="table" />
        <SkeletonLoader variant="table" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 space-y-2">
        <ErrorBanner error={error} />
        <button
          onClick={() => void loadLatest()}
          className="text-xs text-cyan-600 hover:underline"
        >
          {isEs ? 'Reintentar' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" role="main" aria-label="Decision Panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">
          {isEs ? 'Panel de Decisiones' : 'Decision Panel'}
        </h1>
        <div className="flex items-center gap-2">
          {run && (
            <span className="text-[10px] text-slate-400 font-mono">
              {new Date(run.completedAt ?? run.createdAt).toLocaleString()} · {run.durationMs ? fmtMs(run.durationMs) : '—'}
            </span>
          )}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold
              bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            {triggering ? `${progress}%` : isEs ? 'Ejecutar ALM' : 'Run ALM'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {triggering && (
        <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {output ? (
        <>
          {/* Health snapshot: overall gauge (I1) + sub-metrics strip */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {isEs ? 'Salud' : 'Health'}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  output.healthSnapshot.trend === 'improving'
                    ? 'text-emerald-700 bg-emerald-50'
                    : output.healthSnapshot.trend === 'deteriorating'
                      ? 'text-rose-700 bg-rose-50'
                      : 'text-slate-600 bg-slate-50'
                }`}
              >
                {output.healthSnapshot.label} · {output.healthSnapshot.trend}
              </span>
            </div>
            <div className="flex items-start gap-4">
              <HealthScoreWidget
                score={output.healthSnapshot.overall}
                variant="full"
                locale={isEs ? 'es' : 'en'}
              />
              <div className="flex-1">
                <MetricStrip items={healthItems} density="comfortable" />
              </div>
            </div>
          </div>

          {/* Top 5 risks */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
              {isEs ? 'Top 5 Riesgos' : 'Top 5 Risks'}
            </p>
            <DataTable
              columns={riskColumns}
              rows={output.topRisks}
              rowKey={(r) => String(r.rank)}
            />
          </div>

          {/* Decision queue */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
              {isEs ? 'Cola de Decisiones' : 'Decision Queue'}
            </p>
            <DataTable
              columns={queueColumns}
              rows={output.decisionQueue}
              rowKey={(r) => String(r.priority)}
            />
          </div>

          {/* Brief */}
          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {isEs ? 'Resumen Ejecutivo' : 'Executive Brief'}
              </p>
              <Globe className="w-3.5 h-3.5 text-slate-300" />
            </div>
            <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
              {isEs ? output.briefEs : output.brief}
            </p>
          </div>

          {/* Audit trace */}
          <div className="rounded border border-slate-200 bg-white">
            <button
              onClick={() => setTraceOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              {traceOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {isEs ? 'Traza de Auditoría' : 'Audit Trace'}
                <span className="ml-1 text-slate-300">({trace.length} {isEs ? 'pasos' : 'steps'})</span>
              </span>
              {run && (
                <a
                  href={`/api/v1/agents/${selectedId}/runs/${run.id}/trace/export?format=pdf`}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto text-[10px] text-cyan-600 hover:underline flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> PDF
                </a>
              )}
            </button>
            {traceOpen && (
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {trace.map((step) => (
                  <div key={step.id} className="px-3 py-1.5 flex items-start gap-3 text-[11px]">
                    <span className="font-mono text-slate-300 w-5 text-right shrink-0">
                      {step.stepNumber}
                    </span>
                    <span className={`font-mono w-24 shrink-0 ${
                      step.stepKind === 'TOOL_CALL' ? 'text-cyan-600' :
                      step.stepKind === 'LLM_TURN' ? 'text-violet-600' :
                      'text-slate-400'
                    }`}>
                      {step.stepKind}
                    </span>
                    <span className="text-slate-600 truncate">
                      {step.toolName ?? (step.stepKind === 'LLM_TURN' ? 'Claude reasoning' : '—')}
                    </span>
                    <span className="ml-auto text-slate-300 font-mono shrink-0">
                      {step.durationMs != null ? fmtMs(step.durationMs) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-sm gap-2">
          <p>{isEs ? 'Sin análisis reciente' : 'No recent analysis'}</p>
          <p className="text-[10px]">
            {isEs ? 'Ejecute el agente ALM para generar decisiones' : 'Run the ALM agent to generate decisions'}
          </p>
        </div>
      )}
    </div>
  );
}
