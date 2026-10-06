'use client';

import React from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

export interface LiveRateCardProps {
  /** Display label, e.g. "SOFR" */
  label: string;
  /** Current rate value */
  value: number;
  /** Unit for display, e.g. "%" or "bps" */
  unit?: string;
  /** 24h change (positive = up) */
  change24h?: number;
  /** Source label, e.g. "Fed / NY" */
  source?: string;
  /** Historical data points for the sparkline */
  sparklineData?: number[];
  /** Whether the connection is live */
  isLive?: boolean;
  /** Sparkline color override */
  lineColor?: string;
  className?: string;
}

function formatChange(value: number, unit: string): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(unit === 'bps' ? 0 : 2)}${unit}`;
}

/**
 * Card showing a live rate value with sparkline, change indicator, and source label.
 * Used in the Market Data Dashboard for SOFR, Treasuries, and PR deposit rates.
 */
export function LiveRateCard({
  label,
  value,
  unit = '%',
  change24h,
  source,
  sparklineData,
  isLive,
  lineColor,
  className = '',
}: LiveRateCardProps) {
  const changePositive = (change24h ?? 0) >= 0;
  const color = lineColor || (changePositive ? '#059669' : '#dc2626');
  const chartData = (sparklineData || []).map((v) => ({ v }));

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
          {isLive !== undefined && (
            <span
              className={`h-2 w-2 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}
              aria-label={isLive ? 'Live connection' : 'Disconnected'}
            />
          )}
        </div>
        {source && (
          <span className="text-[10px] text-slate-400">{source}</span>
        )}
      </div>

      {/* Value + change */}
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-slate-900">
          {value.toFixed(unit === 'bps' ? 0 : 2)}
          <span className="ml-0.5 text-sm font-medium text-slate-500">{unit}</span>
        </span>
        {change24h !== undefined && (
          <span
            className={`text-xs font-medium tabular-nums ${
              changePositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {formatChange(change24h, unit)}
          </span>
        )}
      </div>

      {/* Sparkline */}
      {chartData.length > 1 && (
        <div className="mt-3 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
