export default function PeerBenchmarkingLoading() {
  return (
    <div className="flex-1 p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg animate-shimmer" />
        <div className="space-y-1.5">
          <div className="h-4 w-56 rounded animate-shimmer" />
          <div className="h-3 w-36 rounded animate-shimmer" />
        </div>
      </div>

      {/* Bar chart skeleton */}
      <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4 h-72 animate-shimmer" />

      {/* Percentile cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4 space-y-3">
            <div className="h-3 w-28 rounded animate-shimmer" />
            <div className="h-5 w-20 rounded animate-shimmer" />
            <div className="h-2 w-full rounded-full animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-4 h-48 animate-shimmer" />

      {/* Sector overview skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-3 space-y-2">
            <div className="h-2.5 w-16 rounded animate-shimmer" />
            <div className="h-6 w-24 rounded animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
