export default function ALMLoading() {
  return (
    <div className="flex-1 p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg animate-shimmer" />
        <div className="space-y-1.5">
          <div className="h-4 w-48 rounded animate-shimmer" />
          <div className="h-3 w-32 rounded animate-shimmer" />
        </div>
      </div>
      {/* KPI grid skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-100 bg-white p-3 space-y-2">
            <div className="h-2.5 w-16 rounded animate-shimmer" />
            <div className="h-6 w-24 rounded animate-shimmer" />
          </div>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-100 bg-white p-4 h-64 animate-shimmer" />
        <div className="rounded-xl border border-slate-100 bg-white p-4 h-64 animate-shimmer" />
      </div>
    </div>
  );
}
