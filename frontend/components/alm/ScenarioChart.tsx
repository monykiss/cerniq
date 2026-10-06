'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';

interface Scenario {
  name: string;
  shiftBps: number;
  niImpact: number;
  niImpactPct: number;
  mveImpact: number;
  mveImpactPct: number;
}

interface ScenarioChartProps {
  scenarios: Scenario[];
  dataKey?: 'niImpact' | 'mveImpact';
  title?: string;
  yAxisLabel?: string;
}

export default function ScenarioChart({
  scenarios,
  dataKey = 'niImpact',
  title = 'NII Impact by Scenario',
  yAxisLabel = '$ Millions',
}: ScenarioChartProps) {
  const sorted = [...scenarios].sort((a, b) => a.shiftBps - b.shiftBps);

  return (
    <div>
      {title && <h3 className="text-sm font-medium text-slate-300 mb-3">{title}</h3>}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={sorted} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: '#f1f5f9',
            }}
            formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, dataKey === 'niImpact' ? 'NII Impact' : 'MVE Impact']}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>
            {sorted.map((entry, index) => (
              <Cell
                key={index}
                fill={entry[dataKey] >= 0 ? '#22c55e' : '#ef4444'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
