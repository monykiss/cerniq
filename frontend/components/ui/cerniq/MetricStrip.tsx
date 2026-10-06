'use client';

import React from 'react';

/**
 * MetricStrip — dense, Bloomberg-style KPI row.
 *
 * Replaces the "card grid of 4 stat boxes" pattern that wastes a third of
 * the viewport on whitespace. Each metric is a tight column: small label,
 * monospace numeric, optional delta with sign-aware color, optional spark.
 *
 * Designed for the top of a workspace where the user wants to scan 5–8
 * numbers at a glance without scrolling.
 */

export interface MetricStripItem {
  label: string;
  value: string | number;
  /** Signed change. Positive renders green, negative renders red. */
  delta?: number;
  /** How to render the delta — number is plain, percent appends "%". */
  deltaFormat?: 'number' | 'percent' | 'currency';
  /** Tiny inline sparkline as a series of numeric points. */
  spark?: number[];
  /** Hover tooltip for context. */
  tooltip?: string;
  /** Click handler — when set, the cell becomes a focusable button. */
  onClick?: () => void;
}

export interface MetricStripProps {
  items: MetricStripItem[];
  /** Visual density. `comfortable` is a touch taller for primary KPIs. */
  density?: 'compact' | 'comfortable';
  className?: string;
}

function fmtDelta(delta: number, format: MetricStripItem['deltaFormat']): string {
  const sign = delta > 0 ? '+' : '';
  if (format === 'percent') return `${sign}${delta.toFixed(1)}%`;
  if (format === 'currency')
    return `${sign}${new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(delta)}`;
  return `${sign}${delta.toLocaleString()}`;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 56;
  const h = 16;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const trendUp = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} className="ml-2 inline-block" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={trendUp ? '#10B981' : '#EF4444'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricStrip({ items, density = 'compact', className = '' }: MetricStripProps) {
  const padY = density === 'compact' ? 'py-2.5' : 'py-3.5';

  return (
    <div
      className={`cerniq-dashboard-surface flex flex-wrap items-stretch overflow-hidden rounded-xl ${className}`}
      role="list"
    >
      {items.map((item, i) => {
        const deltaColor =
          item.delta == null
            ? 'cerniq-dashboard-muted-text'
            : item.delta > 0
              ? 'text-emerald-600'
              : item.delta < 0
                ? 'text-rose-600'
                : 'cerniq-dashboard-subtext';

        const cellClass = `flex min-w-[140px] flex-1 flex-col gap-0.5 px-4 ${padY} ${
          i > 0 ? 'border-l cerniq-dashboard-border' : ''
        } ${item.onClick ? 'cursor-pointer hover:bg-[rgba(247,228,188,0.45)]' : ''}`;

        const inner = (
          <>
            <span className="cerniq-dashboard-subtext text-[10px] font-semibold uppercase tracking-wider">
              {item.label}
            </span>
            <div className="flex items-baseline">
              <span className="cerniq-dashboard-text font-mono text-lg font-semibold tabular-nums">
                {item.value}
              </span>
              {item.spark ? <Sparkline points={item.spark} /> : null}
            </div>
            {item.delta != null ? (
              <span className={`text-[11px] font-medium tabular-nums ${deltaColor}`}>
                {fmtDelta(item.delta, item.deltaFormat ?? 'number')}
              </span>
            ) : null}
          </>
        );

        if (item.onClick) {
          return (
            <button
              key={`${item.label}-${i}`}
              type="button"
              onClick={item.onClick}
              title={item.tooltip}
              className={`${cellClass} text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500`}
              role="listitem"
            >
              {inner}
            </button>
          );
        }
        return (
          <div
            key={`${item.label}-${i}`}
            title={item.tooltip}
            className={cellClass}
            role="listitem"
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
