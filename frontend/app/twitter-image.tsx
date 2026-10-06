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
          alignItems: 'center',
          padding: '60px',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0e7490, #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              fontWeight: 700,
              color: 'white',
            }}
          >
            C
          </div>
          <span style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '0.3em', color: 'white' }}>
            CERNIQ
          </span>
        </div>
        <div style={{ fontSize: '44px', fontWeight: 800, color: 'white', lineHeight: 1.2, marginBottom: '20px', maxWidth: '840px' }}>
          Treasury, risk, portfolio visibility, and board delivery.
        </div>
        <div style={{ fontSize: '20px', color: '#94a3b8', marginBottom: '32px', maxWidth: '860px' }}>
          CFO-first reporting, execution review, and institutional workflow control from one command center.
        </div>
        <div style={{ display: 'flex', gap: '32px' }}>
          {[
            { v: '$750', l: 'Pilot Entry' },
            { v: '4', l: 'Finance Lanes' },
            { v: 'EN/ES', l: 'Board Output' },
          ].map((s) => (
            <div key={s.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '32px', fontWeight: 800, color: '#06b6d4' }}>{s.v}</span>
              <span style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.15em' }}>{s.l}</span>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: '32px', fontSize: '14px', color: '#475569' }}>
          cerniq.io — KLYTICS LLC, San Juan PR
        </div>
      </div>
    ),
    { ...size },
  );
}
