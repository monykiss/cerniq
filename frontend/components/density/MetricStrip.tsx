import type { Locale } from '@/lib/i18n';
import type { LabelUnit } from '@/lib/alm/labels';
import { label, labelUnit } from '@/lib/alm/labels';
import { NumberCell } from './NumberCell';
import { TrendArrow } from './TrendArrow';
import { SparklineCell } from './SparklineCell';

/**
 * MetricStrip — Bloomberg-style horizontal KPI band.
 *
 * Replaces the cards-grid pattern (one rounded-xl per metric) with a single
 * dense row. Designed to fit 8–14 metrics on a 1080p screen at 32px tall.
 *
 * Each metric receives a label (auto-resolved from lib/alm/labels by key, or
 * passed explicitly), a value, optional delta, and optional sparkline.
 *
 * Server-component-compatible — no hooks. Pass `locale` from the parent.
 *
 * Anatomy of one cell (32px tall):
 *   ┌────────────────┐
 *   │ NIM            │  ← label (10px, slate-500, uppercase, tracking-wider)
 *   │ 3.52% ▲ +0.04  │  ← value + delta (sm, tabular, signed color)
 *   │ ▁▂▃▅▆▇         │  ← optional sparkline (60×16)
 *   └────────────────┘
 */

export interface MetricStripItem {
  /** Backend identifier — resolved via labels dictionary if `label` not given */
  key: string;
  /** Override label (otherwise derived from key) */
  label?: string;
  /** Override unit (otherwise derived from key) */
  unit?: LabelUnit;
  value: number | null | undefined;
  /** Period-over-period delta (same unit as value) */
  delta?: number | null;
  /** When true, downward delta is good (NPL, cost ratios, etc) */
  invertedDelta?: boolean;
  /** Sparkline trend (last ~12 values) */
  trend?: readonly number[];
  /** Optional precision override */
  precision?: number;
  /** Optional href to make this cell clickable */
  href?: string;
}

export interface MetricStripProps {
  items: readonly MetricStripItem[];
  locale: Locale;
  /** Visual density. 'compact' is 28px tall (no sparklines), 'standard' is 56px. */
  density?: 'compact' | 'standard';
  /** Show vertical dividers between cells (default true) */
  dividers?: boolean;
  className?: string;
}

export function MetricStrip({
  items,
  locale,
  density = 'standard',
  dividers = true,
  className,
}: MetricStripProps) {
  if (items.length === 0) return null;

  const showSparkline = density === 'standard';
  const cellPaddingY = density === 'compact' ? 'py-1.5' : 'py-2';
  const minWidth = density === 'compact' ? 'min-w-[100px]' : 'min-w-[120px]';

  return (
    <div
      className={`flex w-full overflow-x-auto rounded-lg border border-slate-200 bg-white ${className ?? ''}`}
      role="group"
      aria-label="Key metrics"
    >
      {items.map((item, i) => {
        const displayLabel = item.label ?? label(item.key, locale);
        const unit = item.unit ?? labelUnit(item.key);
        const isLast = i === items.length - 1;

        const content = (
          <>
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500 truncate"
              title={displayLabel}
            >
              {displayLabel}
            </p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <NumberCell value={item.value} unit={unit} precision={item.precision} size="text-base" />
              {item.delta != null ? (
                <TrendArrow delta={item.delta} unit={unit} inverted={item.invertedDelta} />
              ) : null}
            </div>
            {showSparkline && item.trend && item.trend.length >= 2 ? (
              <div className="mt-1">
                <SparklineCell values={item.trend} width={72} height={14} color="auto" />
              </div>
            ) : null}
          </>
        );

        const cellClass =
          `flex-1 ${minWidth} px-3 ${cellPaddingY} ${dividers && !isLast ? 'border-r border-slate-100' : ''}`;

        return item.href ? (
          <a key={item.key} href={item.href} className={`${cellClass} hover:bg-slate-50 transition`}>
            {content}
          </a>
        ) : (
          <div key={item.key} className={cellClass}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
