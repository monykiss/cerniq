import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'CERNIQ — Institutional Treasury and Risk Command Center';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #050C1C 0%, #0a1a3a 50%, #071122 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, #0e7490, #06b6d4, #0e7490)',
          }}
        />

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #0e7490, #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 700,
              color: 'white',
            }}
          >
            C
          </div>
          <span
            style={{
              fontSize: '28px',
              fontWeight: 700,
              letterSpacing: '0.3em',
              color: 'white',
              textTransform: 'uppercase' as const,
            }}
          >
            CERNIQ
          </span>
          <span style={{ fontSize: '14px', color: '#94a3b8', letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
            Command Center
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: '52px',
            fontWeight: 800,
            color: 'white',
            lineHeight: 1.1,
            marginBottom: '24px',
            maxWidth: '900px',
          }}
        >
          Treasury, risk, portfolio visibility, and board delivery in one command center
        </div>

        {/* Subheadline */}
        <div style={{ fontSize: '22px', color: '#94a3b8', marginBottom: '40px', maxWidth: '880px', lineHeight: 1.4 }}>
          CFO-first reporting, execution review, and institutional workflow control across one operating layer.
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '48px' }}>
          {[
            { value: '1', label: 'Command Surface' },
            { value: '4', label: 'Finance Lanes' },
            { value: 'EN/ES', label: 'Board Output' },
            { value: '$750', label: 'Pilot Entry' },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '36px', fontWeight: 800, color: '#06b6d4' }}>{stat.value}</span>
              <span style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            left: '80px',
            right: '80px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '14px', color: '#475569' }}>cerniq.io</span>
          <span style={{ fontSize: '14px', color: '#475569' }}>KLYTICS LLC — San Juan, PR</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
