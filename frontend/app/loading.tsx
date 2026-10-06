import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
      <CerniqMark size="md" />
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
    </div>
  );
}
