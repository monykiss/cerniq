import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function DemoLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <CerniqMark size="md" />
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
      <p className="text-sm text-slate-400">Loading demo...</p>
    </div>
  );
}
