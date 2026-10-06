interface CerniqMarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

interface CerniqLockupProps {
  className?: string;
  compact?: boolean;
  tagline?: string;
}

const markSizes: Record<NonNullable<CerniqMarkProps['size']>, string> = {
  sm: 'h-12 w-12',
  md: 'h-16 w-16',
  lg: 'h-24 w-24',
  xl: 'h-36 w-36',
};

export function CerniqMark({ className = '', size = 'md' }: CerniqMarkProps) {
  return (
    <div className={`cerniq-orbit ${markSizes[size]} ${className}`.trim()}>
      <span className="cerniq-orbit-ring cerniq-orbit-ring-primary" />
      <span className="cerniq-orbit-ring cerniq-orbit-ring-secondary" />
      <span className="cerniq-orbit-ring cerniq-orbit-ring-tertiary" />
      <span className="cerniq-orbit-core" />
      <span className="cerniq-orbit-node cerniq-orbit-node-a" />
      <span className="cerniq-orbit-node cerniq-orbit-node-b" />
      <span className="cerniq-orbit-node cerniq-orbit-node-c" />
      <span className="cerniq-orbit-node cerniq-orbit-node-d" />
      <span className="cerniq-orbit-node cerniq-orbit-node-e" />
    </div>
  );
}

export function CerniqLockup({
  className = '',
  compact = false,
  tagline = 'Inteligencia de Riesgo Institucional',
}: CerniqLockupProps) {
  return (
    <div
      className={`flex items-center ${compact ? 'gap-3' : 'gap-4 sm:gap-6'} ${className}`.trim()}
    >
      <div>
        <div
          className={`font-display uppercase text-slate-950 ${
            compact
              ? 'text-xl tracking-[0.24em]'
              : 'text-[clamp(3rem,10vw,6.8rem)] leading-none tracking-[0.18em]'
          }`}
        >
          Cerniq
        </div>
        {tagline ? (
          <p
            className={`text-cyan-700/80 ${
              compact
                ? 'mt-0.5 text-[10px] tracking-[0.28em] uppercase'
                : 'mt-3 text-sm tracking-[0.42em] uppercase sm:text-lg'
            }`}
          >
            {tagline}
          </p>
        ) : null}
      </div>
      <CerniqMark size={compact ? 'sm' : 'xl'} />
    </div>
  );
}
