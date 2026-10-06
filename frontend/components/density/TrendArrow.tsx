import type { LabelUnit } from '@/lib/alm/labels';

/**
 * TrendArrow — compact period-over-period delta indicator.
 *
 * Renders a triangle + signed delta + unit suffix in 1 inline line.
 * Inverted prop is for metrics where down is good (e.g. NPL, cost ratio).
 *
 *   <TrendArrow delta={0.34} unit="%" />          ▲ +0.34%   emerald
 *   <TrendArrow delta={-12} unit="bps" inverted />▼ −12 bps  emerald (down=good)
 *   <TrendArrow delta={0} />                       ─ 0       slate
 */

export interface TrendArrowProps {
  delta: number | null | undefined;
  unit?: LabelUnit;
  /** When true, negative is good (e.g. risk reduction). Inverts the color. */
  inverted?: boolean;
  /** Hide the numeric label, just show the arrow. */
  arrowOnly?: boolean;
  /** Tailwind text size class (default text-[10px]) */
  size?: string;
}

const SIGNS: Record<'up' | 'down' | 'flat', string> = {
  up:   '▲',
  down: '▼',
  flat: '─',
};

export function TrendArrow({
  delta,
  unit,
  inverted = false,
  arrowOnly = false,
  size = 'text-[10px]',
}: TrendArrowProps) {
  if (delta == null || Number.isNaN(delta)) {
    return <span className={`${size} tabular-nums text-slate-300`}>—</span>;
  }

  const dir: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const isPositiveSignal = inverted ? dir === 'down' : dir === 'up';
  const isNegativeSignal = inverted ? dir === 'up' : dir === 'down';

  const colorClass =
    dir === 'flat'
      ? 'text-slate-400'
      : isPositiveSignal
        ? 'text-emerald-600'
        : isNegativeSignal
          ? 'text-rose-600'
          : 'text-slate-400';

  const absDelta = Math.abs(delta);
  const formatted = unit === 'bps'
    ? absDelta.toFixed(0)
    : unit === '%' || unit === 'ratio'
      ? absDelta.toFixed(2)
      : absDelta.toLocaleString('en-US', { maximumFractionDigits: 2 });

  const suffix = unit === '%' || unit === 'ratio' ? '%' : unit === 'bps' ? ' bps' : '';
  const sign = dir === 'up' ? '+' : dir === 'down' ? '−' : '';

  return (
    <span className={`inline-flex items-center gap-0.5 ${size} tabular-nums font-medium ${colorClass}`}>
      <span aria-hidden>{SIGNS[dir]}</span>
      {arrowOnly ? null : <span>{sign}{formatted}{suffix}</span>}
    </span>
  );
}
