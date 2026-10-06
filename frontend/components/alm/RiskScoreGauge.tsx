'use client';

import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';
import { useTranslation } from '@/lib/i18n';

interface RiskScoreGaugeProps {
  score: number; // 0-100
  size?: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e'; // green
  if (score >= 60) return '#eab308'; // yellow
  if (score >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
}

function getScoreLabelKey(score: number): string {
  if (score >= 80) return 'risk.lowRisk';
  if (score >= 60) return 'risk.moderate';
  if (score >= 40) return 'risk.elevated';
  return 'risk.highRisk';
}

export default function RiskScoreGauge({ score, size = 200 }: RiskScoreGaugeProps) {
  const { t } = useTranslation();
  const color = getScoreColor(score);
  const label = t(getScoreLabelKey(score));
  const data = [{ value: score, fill: color }];

  return (
    <div className="flex flex-col items-center">
      <div style={{ width: size, height: size }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="70%"
            outerRadius="100%"
            barSize={12}
            data={data}
            startAngle={180}
            endAngle={0}
            >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: 'rgba(203, 213, 225, 0.45)' }}
              dataKey="value"
              cornerRadius={6}
              angleAxisId={0}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: size * 0.08 }}>
          <span className="text-3xl font-bold text-slate-950">{score}</span>
          <span className="mt-1 text-xs text-slate-500">/ 100</span>
        </div>
      </div>
      <span className="text-sm font-medium mt-1" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
