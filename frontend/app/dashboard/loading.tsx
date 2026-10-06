export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
        <p className="text-xs text-[var(--dashboard-text-secondary)]">Loading...</p>
      </div>
    </div>
  );
}
