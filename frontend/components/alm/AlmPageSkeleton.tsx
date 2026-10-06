/**
 * AlmPageSkeleton — layout-matching shimmer for AlmPage's loading branch.
 *
 * Replaces the bare spinner with pulsing placeholders that approximate the
 * eventual MetricStrip + section + table layout. This reduces Cumulative
 * Layout Shift (CLS) on slow connections — the skeleton and the loaded
 * content occupy similar bounding boxes, so the first meaningful paint
 * doesn't jump when data arrives.
 *
 * Server-component-compatible (no hooks). Pure Tailwind, pure SVG-free.
 *
 * Accessibility:
 *   - role="status" + aria-busy="true" signals in-progress work
 *   - aria-label describes what is loading so screen readers announce it
 *   - Visually-hidden fallback text for the spinner case
 */

export interface AlmPageSkeletonProps {
  /** Bilingual hint used in aria-label (e.g. module name) */
  readonly label?: string;
}

export function AlmPageSkeleton({ label }: AlmPageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className="space-y-4"
    >
      {/* MetricStrip shimmer — one horizontal band with 7 cells */}
      <div className="flex w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 min-w-[120px] px-3 py-2 ${i === 6 ? '' : 'border-r border-slate-100'}`}
          >
            <div className="h-2 w-12 animate-pulse rounded bg-slate-200" />
            <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-slate-200" />
            <div className="mt-1 h-3 w-18 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>

      {/* Chart shimmer — one tall card with grid stripes */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 h-2 w-36 animate-pulse rounded bg-slate-200" />
        <div className="relative h-[240px] w-full">
          {/* Horizontal grid lines */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 h-px bg-slate-100"
              style={{ top: `${(i + 1) * 20}%` }}
            />
          ))}
          {/* Bar shimmer approximation */}
          <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-2 px-4">
            {Array.from({ length: 10 }).map((_, i) => {
              const heights = [35, 55, 78, 62, 48, 82, 45, 70, 58, 40];
              return (
                <div
                  key={i}
                  className="flex-1 animate-pulse rounded-t bg-slate-200"
                  style={{ height: `${heights[i]}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Table shimmer — header + 5 rows */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex border-b border-slate-100 bg-slate-50/80 px-3 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-1 px-2">
              <div className="h-2 w-14 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, r) => (
          <div key={r} className="flex border-b border-slate-50 px-3 py-2 last:border-0">
            {Array.from({ length: 5 }).map((_, c) => (
              <div key={c} className="flex-1 px-2">
                <div
                  className={`h-3 animate-pulse rounded bg-slate-100 ${
                    c === 0 ? 'w-24' : c === 4 ? 'w-12' : 'w-16'
                  }`}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Visually hidden text for screen readers */}
      <span className="sr-only">{label ?? 'Loading…'}</span>
    </div>
  );
}
