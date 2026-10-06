'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface ClimateScenario {
  readonly category: string;
  readonly probability: number;
  readonly portfolioLoss: number;
  readonly nwrImpact: number;
}

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface ClimateRiskData {
  readonly totalREExposure: number;
  readonly hurricaneAAL: number;
  readonly hurricaneAALPct: number;
  readonly floodZoneExposure: number;
  readonly cat3ScenarioLoss: number;
  readonly cat3NWRImpact: number;
  readonly cat5ScenarioLoss: number;
  readonly riskLevel: RiskLevel;
  readonly mitigationScore: number;
  readonly scenarios: readonly ClimateScenario[];
  readonly narrativeEs: string;
  readonly narrativeEn: string;
}

const CATEGORY_COLORS = ['#f59e0b', '#ea580c', '#dc2626', '#991b1b', '#450a0a'] as const;

function validateClimate(raw: unknown): ClimateRiskData {
  if (!raw || typeof raw !== 'object') throw new Error('Climate risk response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.scenarios)) throw new Error('Climate risk: scenarios must be array');
  if (typeof r.hurricaneAAL !== 'number') throw new Error('Climate risk: missing hurricaneAAL');
  return r as unknown as ClimateRiskData;
}

function getDemo(): ClimateRiskData {
  return {
    totalREExposure: 215,
    hurricaneAAL: 3.8,
    hurricaneAALPct: 0.85,
    floodZoneExposure: 26,
    cat3ScenarioLoss: 38.7,
    cat3NWRImpact: 8.7,
    cat5ScenarioLoss: 129,
    riskLevel: 'HIGH',
    mitigationScore: 45,
    scenarios: [
      { category: 'Cat 1', probability: 0.120, portfolioLoss:   6.5, nwrImpact:  1.5 },
      { category: 'Cat 2', probability: 0.060, portfolioLoss:  17.2, nwrImpact:  3.9 },
      { category: 'Cat 3', probability: 0.030, portfolioLoss:  38.7, nwrImpact:  8.7 },
      { category: 'Cat 4', probability: 0.010, portfolioLoss:  75.3, nwrImpact: 16.9 },
      { category: 'Cat 5', probability: 0.005, portfolioLoss: 129.0, nwrImpact: 29.0 },
    ],
    narrativeEs: 'La AAL por huracanes es $3.8M (0.85% activos). Bajo Cat 3 (María), pérdida de $38.7M (-8.7pp NWR). Nivel: ALTO.',
    narrativeEn: 'Hurricane AAL is $3.8M (0.85% assets). Under Cat 3 (Maria), loss of $38.7M (-8.7pp NWR). Level: HIGH.',
  };
}

function ClimateContent({ data }: { data: ClimateRiskData }) {
  const { locale } = useTranslation();

  const riskBanner = {
    LOW:    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: locale === 'es' ? 'Bajo'  : 'Low' },
    MEDIUM: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   label: locale === 'es' ? 'Medio' : 'Medium' },
    HIGH:   { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    label: locale === 'es' ? 'Alto'  : 'High' },
  }[data.riskLevel];

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 're_exposure',      label: locale === 'es' ? 'Exposición RE'       : 'RE Exposure',       value: data.totalREExposure,   unit: 'USD_M' },
    { key: 'hurricane_aal',    label: locale === 'es' ? 'AAL Huracán'         : 'Hurricane AAL',     value: data.hurricaneAAL,      unit: 'USD_M' },
    { key: 'hurricane_aal_pct',label: locale === 'es' ? 'AAL % Activos'       : 'AAL % Assets',      value: data.hurricaneAALPct,   unit: '%' },
    { key: 'flood_zone_exp',   label: locale === 'es' ? 'Exp. Zona Inundación' : 'Flood Zone Exp.',  value: data.floodZoneExposure, unit: 'USD_M' },
    { key: 'cat3_loss',        label: locale === 'es' ? 'Pérdida Cat 3'       : 'Cat 3 Loss',        value: data.cat3ScenarioLoss,  unit: 'USD_M' },
    { key: 'cat5_loss',        label: locale === 'es' ? 'Pérdida Cat 5'       : 'Cat 5 Loss',        value: data.cat5ScenarioLoss,  unit: 'USD_M' },
    { key: 'mitigation_score', label: locale === 'es' ? 'Score Mitigación'    : 'Mitigation Score',  value: data.mitigationScore,   unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<ClimateScenario>[]>(() => [
    { id: 'cat',    header: locale === 'es' ? 'Categoría'     : 'Category',      kind: 'text',   accessor: (r) => r.category, align: 'text-left' },
    { id: 'prob',   header: locale === 'es' ? 'Probabilidad'  : 'Probability',   kind: 'number', accessor: (r) => r.probability, unit: 'ratio' },
    { id: 'loss',   header: locale === 'es' ? 'Pérdida'       : 'Loss',          kind: 'number', accessor: (r) => r.portfolioLoss, unit: 'USD_M' },
    { id: 'nwr',    header: locale === 'es' ? 'Impacto NWR'   : 'NWR Impact',    kind: 'custom',
      accessor: (r) => r.nwrImpact,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-rose-700">-{r.nwrImpact.toFixed(1)}pp</span>,
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Risk level banner */}
      <section className={`rounded-xl border p-4 ${riskBanner.bg} ${riskBanner.border}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm font-bold ${riskBanner.text}`}>
              {locale === 'es' ? 'Nivel de Riesgo Climático' : 'Climate Risk Level'}: {riskBanner.label}
            </p>
            <p className="mt-1 text-xs text-slate-600">{locale === 'es' ? data.narrativeEs : data.narrativeEn}</p>
          </div>
          <div className={`text-3xl font-black tabular-nums ${riskBanner.text}`}>{data.mitigationScore}</div>
        </div>
      </section>

      {/* Hurricane loss chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pérdida por Categoría de Huracán' : 'Loss by Hurricane Category'}
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.scenarios as ClimateScenario[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0).toFixed(1)}M`, '']} />
            <Bar dataKey="portfolioLoss" name={locale === 'es' ? 'Pérdida' : 'Loss'} radius={[4, 4, 0, 0]}>
              {data.scenarios.map((_s, i) => (
                <Cell key={i} fill={CATEGORY_COLORS[i] ?? '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Scenario detail */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle por Escenario' : 'Scenario Detail'}
        </p>
        <DataTable rows={data.scenarios} columns={columns} locale={locale} rowKey={(r) => r.category} />
      </section>
    </>
  );
}

export default function ClimateRiskPage() {
  return (
    <AlmPage<ClimateRiskData>
      slug="climate-risk"
      iconTint="amber"
      validate={validateClimate}
      getDemo={getDemo}
    >
      {(data) => <ClimateContent data={data} />}
    </AlmPage>
  );
}
