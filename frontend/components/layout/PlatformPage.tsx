import type { ReactNode } from 'react';

interface PlatformPageProps {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
}

export default function PlatformPage({
  kicker,
  title,
  description,
  actions,
  meta,
  children,
  maxWidthClassName = 'max-w-7xl',
}: PlatformPageProps) {
  return (
    <div className="cerniq-dashboard-theme cerniq-dashboard-page overflow-x-clip px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className={`mx-auto space-y-6 ${maxWidthClassName}`}>
        <section className="cerniq-shell p-6 sm:p-8">
          <div className="cerniq-data-wave" />
          <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <span className="cerniq-kicker mb-5">{kicker}</span>
              <h1 className="font-display text-3xl text-slate-950 sm:text-5xl">{title}</h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">{description}</p>
              {meta ? <div className="mt-6 flex flex-wrap gap-3">{meta}</div> : null}
            </div>

            {actions ? <div className="relative z-10 flex flex-wrap gap-3 xl:justify-end">{actions}</div> : null}
          </div>
        </section>

        {children}
      </div>
    </div>
  );
}
