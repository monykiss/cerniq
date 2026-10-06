'use client';

import React, { useState } from 'react';
import type { DataGap } from '@/hooks/useReportDataGaps';

// ─── DataGapBanner — MetricStrip-style gap warning ──────────────
//
// Convention (SESSION_HANDOFF §8 + D1):
// When a report has any gap, the top shows a single-line banner:
//   ⚠ 2 critical gaps · 1 warning · view details
//
// Expandable: clicking "view details" shows the full gap manifest.

export interface DataGapBannerProps {
  gaps: DataGap[];
  criticalCount: number;
  warningCount: number;
  className?: string;
}

export function DataGapBanner({
  gaps,
  criticalCount,
  warningCount,
  className = '',
}: DataGapBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (gaps.length === 0) return null;

  const isCritical = criticalCount > 0;
  const borderColor = isCritical
    ? 'border-amber-400/60'
    : 'border-yellow-300/60';
  const bgColor = isCritical ? 'bg-amber-50' : 'bg-yellow-50';
  const textColor = isCritical ? 'text-amber-800' : 'text-yellow-800';

  return (
    <div
      className={`rounded-lg border ${borderColor} ${bgColor} ${className}`}
      role="alert"
      aria-live="polite"
    >
      {/* Summary line */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className={`flex items-center gap-2 text-sm font-medium ${textColor}`}>
          <span aria-hidden="true">&#9888;</span>
          <span>
            {criticalCount > 0 && (
              <>
                <strong>{criticalCount}</strong>{' '}
                {criticalCount === 1 ? 'critical gap' : 'critical gaps'}
              </>
            )}
            {criticalCount > 0 && warningCount > 0 && ' · '}
            {warningCount > 0 && (
              <>
                <strong>{warningCount}</strong>{' '}
                {warningCount === 1 ? 'warning' : 'warnings'}
              </>
            )}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`text-xs font-semibold ${textColor} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded px-1`}
          aria-expanded={expanded}
        >
          {expanded ? 'hide details' : 'view details'}
        </button>
      </div>

      {/* Expanded detail table */}
      {expanded && (
        <div className="border-t border-amber-200/60 px-4 py-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-amber-600/80">
                <th className="pb-1.5 pr-3 font-semibold">Severity</th>
                <th className="pb-1.5 pr-3 font-semibold">Field</th>
                <th className="pb-1.5 pr-3 font-semibold">Reason</th>
                <th className="pb-1.5 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap, i) => (
                <tr key={`${gap.field}-${i}`} className="border-t border-amber-100/60">
                  <td className="py-1.5 pr-3">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        gap.severity === 'CRITICAL'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {gap.severity}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-amber-900">{gap.field}</td>
                  <td className="py-1.5 pr-3 text-amber-700">{gap.reason}</td>
                  <td className="py-1.5 text-amber-700">{gap.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GapCell — Per-cell gap-aware rendering ─────────────────────
//
// When a metric field has a gap, render em dash with hover tooltip
// instead of the numeric value.
//
// Convention: missing = `—` in text-muted-foreground, hover = gap reason.

export interface GapCellProps {
  gap: DataGap;
  className?: string;
}

export function GapCell({ gap, className = '' }: GapCellProps) {
  return (
    <span
      className={`text-slate-400 cursor-help ${className}`}
      title={`${gap.severity}: ${gap.reason}\n${gap.action}`}
      aria-label={`Data unavailable: ${gap.reason}`}
    >
      —
    </span>
  );
}

// ─── MetricCell — Renders value OR gap ──────────────────────────
//
// Usage:
//   <MetricCell value={lcr} gap={gapForField('liquidity.lcr')} format="percent" />

export interface MetricCellProps {
  value: number | string | null | undefined;
  gap?: DataGap;
  format?: 'number' | 'percent' | 'currency' | 'raw';
  className?: string;
}

export function MetricCell({
  value,
  gap,
  format = 'raw',
  className = '',
}: MetricCellProps) {
  if (gap) {
    return <GapCell gap={gap} className={className} />;
  }

  if (value === null || value === undefined) {
    return (
      <span className={`text-slate-400 ${className}`} aria-label="No data">
        —
      </span>
    );
  }

  const formatted = formatValue(value, format);
  return <span className={className}>{formatted}</span>;
}

function formatValue(
  value: number | string,
  format: MetricCellProps['format'],
): string {
  if (typeof value === 'string') return value;

  switch (format) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value);
    case 'number':
      return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    default:
      return String(value);
  }
}
