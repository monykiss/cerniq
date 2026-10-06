/**
 * SparklineCell — pure-SVG inline trend mark.
 *
 * Why not Recharts? Recharts ResponsiveContainer + LineChart at this size
 * costs ~12kb of client JS and triggers a layout/measure pass per cell.
 * For a 60×16 dataviz primitive that may render 50× per page, we hand-roll
 * a 30-line SVG path generator. Server-component-compatible.
 *
 * The path is computed deterministically — same input always produces the
 * same path string, so React reconciliation is cheap.
 */

export interface SparklineCellProps {
  values: readonly number[];
  width?: number;
  height?: number;
  /** Stroke color. Defaults to slate-500. */
  color?: string;
  /** When true, fills under the curve at 10% opacity */
  filled?: boolean;
  /** Show the final point as a small dot */
  showEndDot?: boolean;
  className?: string;
}

export function SparklineCell({
  values,
  width = 60,
  height = 16,
  color = '#64748b', // slate-500
  filled = false,
  showEndDot = true,
  className,
}: SparklineCellProps) {
  if (!values || values.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#e2e8f0" strokeWidth={1} />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const padY = 1.5;
  const innerH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`))
    .join(' ');

  const fillD = filled
    ? `${pathD} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`
    : null;

  // Auto-color: green if last >= first, red if last < first, unless overridden
  const autoColor =
    color === 'auto'
      ? values[values.length - 1]! >= values[0]!
        ? '#059669' // emerald-600
        : '#dc2626' // red-600
      : color;

  const [endX, endY] = points[points.length - 1]!;

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      {fillD ? <path d={fillD} fill={autoColor} fillOpacity={0.1} /> : null}
      <path d={pathD} fill="none" stroke={autoColor} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      {showEndDot ? <circle cx={endX} cy={endY} r={1.5} fill={autoColor} /> : null}
    </svg>
  );
}
