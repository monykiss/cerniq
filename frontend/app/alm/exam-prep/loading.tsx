export default function ExamPrepLoading() {
  return (
    <div className="flex-1 p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg animate-shimmer" />
        <div className="space-y-1.5">
          <div className="h-4 w-64 rounded animate-shimmer" />
          <div className="h-3 w-48 rounded animate-shimmer" />
        </div>
      </div>
      {/* Top row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-6 h-52 animate-shimmer" />
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 h-52 animate-shimmer" />
      </div>
      {/* Findings skeleton */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 h-48 animate-shimmer" />
      {/* Actions skeleton */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 h-40 animate-shimmer" />
      {/* Docs skeleton */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 h-48 animate-shimmer" />
    </div>
  );
}
