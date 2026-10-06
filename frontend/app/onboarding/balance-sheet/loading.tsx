import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function BalanceSheetLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-full max-w-2xl space-y-6 animate-pulse">
        <div className="flex justify-center">
          <CerniqMark size="md" />
        </div>
        <div className="space-y-4 px-8">
          <div className="h-5 w-56 mx-auto rounded bg-slate-800" />
          <div className="h-3 w-72 mx-auto rounded bg-slate-800" />
          {/* Progress bar skeleton */}
          <div className="h-2 rounded-full bg-slate-800 mt-6" />
          {/* Form field skeletons */}
          <div className="space-y-4 mt-8">
            <div className="h-4 w-40 rounded bg-slate-800" />
            <div className="h-12 rounded-lg bg-slate-800" />
            <div className="h-4 w-36 rounded bg-slate-800" />
            <div className="h-12 rounded-lg bg-slate-800" />
            <div className="h-4 w-32 rounded bg-slate-800" />
            <div className="h-12 rounded-lg bg-slate-800" />
          </div>
          {/* Button skeleton */}
          <div className="flex justify-between mt-6">
            <div className="h-11 w-24 rounded-lg bg-slate-800" />
            <div className="h-11 w-24 rounded-lg bg-slate-700" />
          </div>
        </div>
      </div>
    </div>
  );
}
