import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function OnboardingLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-full max-w-lg space-y-6 animate-pulse">
        <div className="flex justify-center">
          <CerniqMark size="md" />
        </div>
        <div className="space-y-4 px-8">
          <div className="h-5 w-48 mx-auto rounded bg-slate-800" />
          <div className="h-3 w-64 mx-auto rounded bg-slate-800" />
          <div className="space-y-3 mt-8">
            <div className="h-12 rounded-lg bg-slate-800" />
            <div className="h-12 rounded-lg bg-slate-800" />
            <div className="h-12 rounded-lg bg-slate-800" />
          </div>
          <div className="h-11 rounded-lg bg-slate-700 mt-4" />
        </div>
      </div>
    </div>
  );
}
