import type { LabelUnit } from '@/lib/alm/labels';

/**
 * NumberCell — unit-aware locale-aware number renderer.
 *
 * Handles the formatting decisions that every quant module re-implemented
 * inline (with subtle bugs): precision per unit, percent vs basis points,
 * dollar millions vs thousands, negative-value sign coloring, monospace
 * tabular alignment.
 *
 * Server-component-compatible — no hooks. Pass `locale` from the parent.
 *
 * Examples:
 *   <NumberCell value={3.521} unit="%" />        →  3.52%
 *   <NumberCell value={1245.7} unit="USD_M" />   →  $1,245.7M
 *   <NumberCell value={-12} unit="bps" signed /> →  −12 bps  (rose-600)
 *   <NumberCell value={0.0042} unit="ratio" />   →  0.42%
 */

export interface NumberCellProps {
  value: number | null | undefined;
  unit?: LabelUnit;
  /** Override default precision for the unit */
  precision?: number;
  /** Color negative values rose, positive emerald (default false) */
  signed?: boolean;
  /** Show explicit + on positives (implies signed) */
  explicitSign?: boolean;
  /** Render '—' instead of empty for null/undefined (default true) */
  showDash?: boolean;
  /** Tailwind text size class (default text-sm) */
  size?: 'text-xs' | 'text-sm' | 'text-base' | 'text-lg' | 'text-xl' | 'text-2xl';
  /** Override the formatted color */
  className?: string;
}

const DEFAULT_PRECISION: Record<LabelUnit, number> = {
  '%':       2,
  bps:       0,
  USD:       0,
  USD_M:     1,
  USD_K:     0,
  x:         2,
  days:      0,
  years:     2,
  count:     0,
  ratio:     4,
};

function formatValue(value: number, unit: LabelUnit | undefined, precision: number): string {
  switch (unit) {
    case '%':
      return value.toFixed(precision);
    case 'bps':
      return value.toFixed(precision);
    case 'USD':
      return value.toLocaleString('en-US', { maximumFractionDigits: precision, minimumFractionDigits: precision });
    case 'USD_M':
    case 'USD_K':
      return value.toLocaleString('en-US', { maximumFractionDigits: precision, minimumFractionDigits: precision });
    case 'x':
    case 'years':
      return value.toFixed(precision);
    case 'days':
    case 'count':
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'ratio':
      // Express decimal ratio as percent: 0.0421 → 4.21%
      return (value * 100).toFixed(precision);
    default:
      return value.toLocaleString('en-US', { maximumFractionDigits: precision });
  }
}

function suffixFor(unit: LabelUnit | undefined): string {
  switch (unit) {
    case '%':     return '%';
    case 'bps':   return ' bps';
    case 'USD':   return '';
    case 'USD_M': return 'M';
    case 'USD_K': return 'K';
    case 'x':     return 'x';
    case 'days':  return 'd';
    case 'years': return 'y';
    case 'ratio': return '%';
    default:      return '';
  }
}

function prefixFor(unit: LabelUnit | undefined): string {
  switch (unit) {
    case 'USD':
    case 'USD_M':
    case 'USD_K':
      return '$';
    default:
      return '';
  }
}

export function NumberCell({
  value,
  unit,
  precision,
  signed = false,
  explicitSign = false,
  showDash = true,
  size = 'text-sm',
  className,
}: NumberCellProps) {
  if (value == null || Number.isNaN(value)) {
    return <span className={`${size} tabular-nums text-slate-300 ${className ?? ''}`}>{showDash ? '—' : ''}</span>;
  }

  const p = precision ?? (unit ? DEFAULT_PRECISION[unit] : 2);
  const isNeg = value < 0;
  const showSign = signed || explicitSign;
  const sign = isNeg ? '−' : explicitSign && value > 0 ? '+' : '';
  const colorClass = !showSign
    ? 'text-slate-950'
    : isNeg
      ? 'text-rose-700'
      : value > 0
        ? 'text-emerald-700'
        : 'text-slate-500';

  const formatted = formatValue(Math.abs(value), unit, p);
  const prefix = prefixFor(unit);
  const suffix = suffixFor(unit);

  return (
    <span className={`${size} tabular-nums font-semibold ${colorClass} ${className ?? ''}`}>
      {sign}{prefix}{formatted}{suffix}
    </span>
  );
}
