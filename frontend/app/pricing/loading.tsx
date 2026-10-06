import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function PricingLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center pt-24 px-6 animate-pulse">
      <CerniqMark size="md" />
      <div className="h-6 w-48 rounded bg-slate-800 mt-8" />
      <div className="h-3 w-72 rounded bg-slate-800 mt-3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 w-full max-w-4xl">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="h-4 w-20 rounded bg-slate-800" />
            <div className="h-8 w-28 rounded bg-slate-800" />
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-slate-800" />
              <div className="h-3 w-3/4 rounded bg-slate-800" />
              <div className="h-3 w-5/6 rounded bg-slate-800" />
            </div>
            <div className="h-10 rounded-lg bg-slate-800 mt-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
