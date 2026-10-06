'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';

import { AlmPage, type AlmPageContext } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { useALM } from '@/components/alm/ALMProvider';
import { resolveAlmEndpoint } from '@/hooks/useAlmEndpoint';
import type { DataGap } from '@/hooks/useReportDataGaps';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import {
  isLifecycleStage,
  StageBadge,
  STAGE_OPTIONS,
  type LifecycleStage,
} from './lifecycle-stage';

/**
 * Member 360 directory — Wave 3 / Layer 3 (docs/CERNIQ_LAYER2_3_ROADMAP.md §4).
 *
 * Fixture-first: ships on the deterministic MemberFixtureService book so the
 * whole surface is demoable today, with a real core-system adapter swappable
 * in later behind the same backend response shape. When an institution has
 * zero members on file, this renders an actionable seed-demo prompt instead
 * of either silent zeros or a dead end (D1 — never silent zeros).
 */

const PAGE_SIZE = 25;

interface MemberDirectoryRow {
  id: string;
  memberNumber: string;
  fullName: string;
  memberSince: string;
  lifecycleStage: LifecycleStage;
  riskScore: number | null;
  totalDeposits: number;
  totalLoans: number;
}

interface MemberDirectoryResult {
  institutionId: string;
  total: number;
  page: number;
  pageSize: number;
  members: MemberDirectoryRow[];
  gaps: DataGap[];
}

function validateMemberDirectory(raw: unknown): MemberDirectoryResult {
  const r = raw as Partial<MemberDirectoryResult> | null;
  if (
    !r ||
    typeof r !== 'object' ||
    !Array.isArray(r.members) ||
    typeof r.total !== 'number' ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number'
  ) {
    throw new Error('Malformed member directory response');
  }
  for (const m of r.members) {
    if (!isLifecycleStage(m.lifecycleStage)) {
      throw new Error(`Unrecognized lifecycleStage: ${String(m.lifecycleStage)}`);
    }
  }
  return r as MemberDirectoryResult;
}

export default function Member360DirectoryPage() {
  const [stage, setStage] = useState<LifecycleStage | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [seedNonce, setSeedNonce] = useState(0);

  return (
    <AlmPage<MemberDirectoryResult>
      slug="member-360"
      iconTint="cyan"
      validate={validateMemberDirectory}
      queryParams={{
        stage: stage === 'ALL' ? undefined : stage,
        page,
        pageSize: PAGE_SIZE,
      }}
      deps={[stage, page, seedNonce]}
      controls={
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as LifecycleStage | 'ALL');
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
        >
          {STAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.en} / {opt.es}
            </option>
          ))}
        </select>
      }
    >
      {(data, ctx) => (
        <MemberDirectoryContent
          data={data}
          ctx={ctx}
          page={page}
          onPageChange={setPage}
          onSeeded={() => setSeedNonce((n) => n + 1)}
        />
      )}
    </AlmPage>
  );
}

function MemberDirectoryContent({
  data,
  ctx,
  page,
  onPageChange,
  onSeeded,
}: {
  data: MemberDirectoryResult;
  ctx: AlmPageContext;
  page: number;
  onPageChange: (page: number) => void;
  onSeeded: () => void;
}) {
  const { locale, mod } = ctx;
  const { selectedId } = useALM();
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const handleSeed = useCallback(async () => {
    if (!selectedId || !mod.endpoint) return;
    setSeeding(true);
    setSeedError(null);
    try {
      const url = resolveAlmEndpoint(mod.endpoint, selectedId, undefined, '/seed-demo');
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 50 }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { skipped?: boolean; reason?: string };
      if (body.skipped) {
        setSeedError(body.reason ?? 'Seed was skipped.');
        return;
      }
      onSeeded();
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }, [selectedId, mod.endpoint, onSeeded]);

  if (data.total === 0) {
    return (
      <div className="space-y-4">
        <AlmDataUnavailable
          gaps={data.gaps}
          message={{
            en: 'No members are on file for this institution yet.',
            es: 'Todavía no hay socios registrados para esta institución.',
          }}
        />
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-4 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {seeding
              ? locale === 'es'
                ? 'Generando…'
                : 'Seeding…'
              : locale === 'es'
                ? 'Generar 50 socios de muestra'
                : 'Seed 50 demo members'}
          </button>
          {seedError ? <p className="text-xs text-rose-600">{seedError}</p> : null}
        </div>
      </div>
    );
  }

  const stageCount = (stage: LifecycleStage) =>
    data.members.filter((m) => m.lifecycleStage === stage).length;

  const metrics: MetricStripItem[] = [
    { key: 'total', label: locale === 'es' ? 'Total (página)' : 'Total (page)', value: data.members.length, unit: 'count' },
    { key: 'atRiskCount', label: locale === 'es' ? 'En Riesgo' : 'At Risk', value: stageCount('AT_RISK'), unit: 'count' },
    { key: 'delinquentCount', label: locale === 'es' ? 'Morosos' : 'Delinquent', value: stageCount('DELINQUENT'), unit: 'count' },
    { key: 'workoutCount', label: locale === 'es' ? 'Reestructuración' : 'Workout', value: stageCount('WORKOUT'), unit: 'count' },
  ];

  const columns: DataTableColumn<MemberDirectoryRow>[] = [
    {
      id: 'memberNumber',
      headerKey: 'memberNumber',
      kind: 'custom',
      accessor: (r) => r.memberNumber,
      width: 'w-28',
      render: (r) => (
        <Link
          href={`/alm/member-360/${r.id}?id=${data.institutionId}`}
          className="font-mono text-xs font-semibold text-cyan-700 hover:underline"
        >
          {r.memberNumber}
        </Link>
      ),
    },
    { id: 'fullName', headerKey: 'fullName', kind: 'text', accessor: (r) => r.fullName },
    {
      id: 'memberSince',
      headerKey: 'memberSince',
      kind: 'custom',
      accessor: () => null,
      render: (r) => (
        <span className="text-xs text-slate-600">
          {new Date(r.memberSince).toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US')}
        </span>
      ),
    },
    {
      id: 'lifecycleStage',
      headerKey: 'lifecycleStage',
      kind: 'custom',
      accessor: () => null,
      render: (r) => <StageBadge stage={r.lifecycleStage} locale={locale} />,
    },
    { id: 'riskScore', headerKey: 'riskScore', kind: 'number', accessor: (r) => r.riskScore, unit: 'count' },
    { id: 'totalDeposits', headerKey: 'totalDeposits', kind: 'number', accessor: (r) => r.totalDeposits, unit: 'USD' },
    { id: 'totalLoans', headerKey: 'totalLoans', kind: 'number', accessor: (r) => r.totalLoans, unit: 'USD' },
  ];

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <MetricStrip items={metrics} locale={locale} />
      <DataTable
        rows={data.members}
        columns={columns}
        locale={locale}
        rowKey={(r) => r.id}
        emptyText={locale === 'es' ? 'Sin socios' : 'No members'}
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {locale === 'es'
            ? `Mostrando ${data.members.length} de ${data.total} socios — página ${page} de ${totalPages}`
            : `Showing ${data.members.length} of ${data.total} members — page ${page} of ${totalPages}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {locale === 'es' ? 'Anterior' : 'Previous'}
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {locale === 'es' ? 'Siguiente' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
