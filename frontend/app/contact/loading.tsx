import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function ContactLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center animate-pulse">
      <div className="w-full max-w-md space-y-6 px-6">
        <div className="flex justify-center"><CerniqMark size="md" /></div>
        <div className="h-5 w-36 mx-auto rounded bg-slate-800" />
        <div className="space-y-4">
          <div className="h-10 rounded-lg bg-slate-800" />
          <div className="h-10 rounded-lg bg-slate-800" />
          <div className="h-28 rounded-lg bg-slate-800" />
          <div className="h-11 rounded-lg bg-slate-700" />
        </div>
      </div>
    </div>
  );
}
