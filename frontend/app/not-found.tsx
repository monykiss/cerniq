import Link from 'next/link';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import { PUBLIC_PATHS } from '@/lib/public-links';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <CerniqMark size="md" />
        <div className="mt-6 text-6xl font-bold text-[#1B3A6B]">404</div>
        <h1 className="mt-3 text-xl font-bold text-white">Page not found</h1>
        <p className="mt-1 text-sm text-slate-400">
          The page you&apos;re looking for doesn&apos;t exist in CERNIQ.
        </p>
        <p className="text-sm text-slate-500">
          La pagina que busca no existe en CERNIQ.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href={PUBLIC_PATHS.home}
            className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Back to home
          </Link>
          <Link
            href={PUBLIC_PATHS.contact}
            className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
          >
            Contact support
          </Link>
        </div>
      </div>
    </div>
  );
}
