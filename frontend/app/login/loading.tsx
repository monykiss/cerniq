import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function LoginLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6 animate-pulse">
        <div className="flex justify-center">
          <CerniqMark size="md" />
        </div>
        <div className="space-y-4 px-6">
          <div className="h-10 rounded-lg bg-slate-800" />
          <div className="h-10 rounded-lg bg-slate-800" />
          <div className="h-11 rounded-lg bg-slate-800" />
        </div>
      </div>
    </div>
  );
}
