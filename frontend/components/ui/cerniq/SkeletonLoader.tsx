'use client';

import React from 'react';

/* ─── Shimmer animation (CSS-only) ─── */
const shimmerStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, #E6D2A6 25%, #FFFBEF 50%, #E6D2A6 75%)',
  backgroundSize: '200% 100%',
  animation: 'cerniq-shimmer 1.5s infinite ease-in-out',
};

/* ─── Variants ─── */

function CardSkeleton() {
  return (
    <div className="cerniq-dashboard-surface rounded-2xl p-5 space-y-3">
      <div className="h-3 w-20 rounded-full" style={shimmerStyle} />
      <div className="h-7 w-2/3 rounded-lg" style={shimmerStyle} />
      <div className="h-3 w-1/2 rounded-full" style={shimmerStyle} />
      <div className="h-3 w-3/4 rounded-full" style={shimmerStyle} />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="cerniq-dashboard-surface overflow-hidden rounded-2xl">
      {/* Header row */}
      <div className="cerniq-dashboard-muted-surface flex gap-4 border-b px-6 py-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3 flex-1 rounded-full" style={shimmerStyle} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: 5 }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className={`flex gap-4 px-6 py-4 ${rowIdx > 0 ? 'border-t cerniq-dashboard-border' : ''}`}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-4 flex-1 rounded-full"
              style={{
                ...shimmerStyle,
                maxWidth: `${50 + (((rowIdx * 3 + i * 7) % 5) * 10)}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="cerniq-dashboard-surface rounded-2xl px-4 py-3 space-y-2">
      <div className="h-2.5 w-24 rounded-full" style={shimmerStyle} />
      <div className="h-2 w-16 rounded-full" style={shimmerStyle} />
      <div className="h-7 w-20 rounded-lg mt-1" style={shimmerStyle} />
      <div className="h-4 w-28 rounded-full" style={shimmerStyle} />
    </div>
  );
}

function TextSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="h-4 w-full rounded-full" style={shimmerStyle} />
      <div className="h-4 w-5/6 rounded-full" style={shimmerStyle} />
      <div className="h-4 w-3/4 rounded-full" style={shimmerStyle} />
    </div>
  );
}

/* ─── Global keyframes (injected once) ─── */
const KEYFRAMES_ID = 'cerniq-shimmer-keyframes';

function ShimmerKeyframes() {
  if (typeof document !== 'undefined' && document.getElementById(KEYFRAMES_ID)) {
    return null;
  }
  return (
    <style id={KEYFRAMES_ID}>{`
      @keyframes cerniq-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
  );
}

/* ─── Main component ─── */

export interface SkeletonLoaderProps {
  variant: 'card' | 'table' | 'metric' | 'text';
  count?: number;
}

export function SkeletonLoader({ variant, count = 1 }: SkeletonLoaderProps) {
  const items = Array.from({ length: count });

  const VariantComponent = {
    card: CardSkeleton,
    table: TableSkeleton,
    metric: MetricSkeleton,
    text: TextSkeleton,
  }[variant];

  const gridClass =
    variant === 'metric'
      ? 'grid grid-cols-1 gap-3 sm:grid-cols-3'
      : variant === 'card'
        ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
        : 'space-y-4';

  return (
    <>
      <ShimmerKeyframes />
      <div className={gridClass}>
        {items.map((_, i) => (
          <VariantComponent key={i} />
        ))}
      </div>
    </>
  );
}
