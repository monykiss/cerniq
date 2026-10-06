'use client';

import { useMemo } from 'react';
import { Treemap, ResponsiveContainer } from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface HRPChild {
  readonly name: string;
  readonly weight: number;
  readonly ret: number;
}

interface HRPCluster {
  readonly name: string;
  readonly children: readonly HRPChild[];
}

interface HRPFlatWeight {
  readonly asset: string;
  readonly cluster: string;
  readonly weight: number;
}

interface HRPResult extends AlmDataShell {
  // D1: null when there is no asset portfolio to cluster.
  readonly totalAssets: number | null;
  readonly clusterCount: number | null;
  readonly diversificationRatio: number | null;
  readonly maxDrawdown: number | null;
  readonly clusters: readonly HRPCluster[];
  readonly flatWeights: readonly HRPFlatWeight[];
}

const CLUSTER_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#818cf8', '#4f46e5', '#7c3aed', '#5b21b6'] as const;

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string | number;
  index?: number;
}

function validateHRP(raw: unknown): HRPResult {
  if (!raw || typeof raw !== 'object') throw new Error('HRP response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.clusters)) throw new Error('HRP: clusters must be array');
  if (!Array.isArray(r.flatWeights)) throw new Error('HRP: flatWeights must be array');
  return r as unknown as HRPResult;
}

function getDemo(): HRPResult {
  return {
    totalAssets: 6,
    clusterCount: 3,
    diversificationRatio: 1.72,
    maxDrawdown: 0.065,
    clusters: [
      { name: 'Rates',      children: [{ name: 'UST 5Y',   weight: 0.22, ret: 0.041 }, { name: 'UST 10Y', weight: 0.18, ret: 0.044 }] },
      { name: 'Credit',     children: [{ name: 'IG Corp',  weight: 0.15, ret: 0.055 }, { name: 'Munis',   weight: 0.20, ret: 0.038 }] },
      { name: 'Structured', children: [{ name: 'Agency MBS', weight: 0.15, ret: 0.048 }, { name: 'CMBS',  weight: 0.10, ret: 0.062 }] },
    ],
    flatWeights: [
      { asset: 'UST 5Y',     cluster: 'Rates',      weight: 0.22 },
      { asset: 'UST 10Y',    cluster: 'Rates',      weight: 0.18 },
      { asset: 'IG Corp',    cluster: 'Credit',     weight: 0.15 },
      { asset: 'Munis',      cluster: 'Credit',     weight: 0.20 },
      { asset: 'Agency MBS', cluster: 'Structured', weight: 0.15 },
      { asset: 'CMBS',       cluster: 'Structured', weight: 0.10 },
    ],
  };
}

function HRPContent({ data }: { data: HRPResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'cluster_count',       label: locale === 'es' ? 'Clústeres'         : 'Clusters',              value: data.clusterCount,          unit: 'count' },
    { key: 'diversification',     label: locale === 'es' ? 'Diversificación'   : 'Diversification Ratio', value: data.diversificationRatio,  unit: 'x' },
    { key: 'max_drawdown',        label: locale === 'es' ? 'Máx Drawdown'      : 'Max Drawdown',          value: data.maxDrawdown,           unit: 'ratio' },
    { key: 'asset_count',         label: locale === 'es' ? 'Activos'           : 'Assets',                value: data.flatWeights.length,    unit: 'count' },
    { key: 'largest_weight',      label: locale === 'es' ? 'Mayor Peso'        : 'Largest Weight',        value: Math.max(...data.flatWeights.map((w) => w.weight)), unit: 'ratio' },
    { key: 'smallest_weight',     label: locale === 'es' ? 'Menor Peso'        : 'Smallest Weight',       value: Math.min(...data.flatWeights.map((w) => w.weight)), unit: 'ratio' },
  ], [data, locale]);

  const treemapData = useMemo(
    () => data.clusters.map((c) => ({
      name: c.name,
      children: c.children.map((ch) => ({ name: ch.name, size: ch.weight * 1000 })),
    })),
    [data],
  );

  const weightColumns = useMemo<readonly DataTableColumn<HRPFlatWeight>[]>(() => [
    { id: 'asset', header: locale === 'es' ? 'Activo' : 'Asset', kind: 'text', accessor: (r) => r.asset, align: 'text-left' },
    { id: 'cluster', header: locale === 'es' ? 'Clúster' : 'Cluster', kind: 'custom',
      accessor: (r) => r.cluster,
      render: (r) => <span className="text-[11px] text-slate-500">{r.cluster}</span>,
      align: 'text-left',
    },
    { id: 'weight', header: locale === 'es' ? 'Peso' : 'Weight', kind: 'number', accessor: (r) => r.weight, unit: 'ratio' },
    { id: 'bar', header: '', kind: 'custom', accessor: (r) => r.weight,
      render: (r) => (
        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500"
            style={{ width: `${Math.min(100, r.weight * 100 * 3)}%` }}
          />
        </div>
      ),
    },
  ], [locale]);

  // D1: no asset portfolio to cluster → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.flatWeights.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'Hierarchical Risk Parity needs an asset portfolio with a return history to cluster. Load the securities portfolio to compute the HRP allocation.',
          es: 'La Paridad de Riesgo Jerárquica requiere una cartera de activos con historial de retornos para agrupar. Cargue la cartera de valores para calcular la asignación HRP.',
        }}
      />
    );
  }

  return (
    <>
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Treemap */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Treemap — Pesos por Clúster' : 'Treemap — Weights by Cluster'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <Treemap
            data={treemapData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="#fff"
            content={({ x = 0, y = 0, width = 0, height = 0, name, index = 0 }: TreemapContentProps) => (
              <g>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={CLUSTER_COLORS[index % CLUSTER_COLORS.length]}
                  rx={4}
                  opacity={0.85}
                />
                {width > 50 && height > 25 ? (
                  <text
                    x={x + width / 2}
                    y={y + height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={10}
                    fontWeight={600}
                  >
                    {name ?? ''}
                  </text>
                ) : null}
              </g>
            )}
          />
        </ResponsiveContainer>
      </section>

      {/* Weights table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pesos HRP' : 'HRP Weights'}
        </p>
        <DataTable rows={data.flatWeights} columns={weightColumns} locale={locale} rowKey={(r) => r.asset} />
      </section>
    </>
  );
}

export default function HRPPage() {
  return (
    <AlmPage<HRPResult>
      slug="hrp"
      iconTint="indigo"
      validate={validateHRP}
      getDemo={getDemo}
    >
      {(data) => <HRPContent data={data} />}
    </AlmPage>
  );
}
