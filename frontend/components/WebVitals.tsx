'use client';

import { useEffect } from 'react';

export function WebVitals() {
  useEffect(() => {
    // Dynamic import to avoid blocking initial render
    Promise.all([
      import('web-vitals'),
      import('@/lib/web-vitals'),
    ]).then(([{ onCLS, onFCP, onLCP, onTTFB, onINP }, { reportWebVital }]) => {
      onCLS(reportWebVital);
      onFCP(reportWebVital);
      onLCP(reportWebVital);
      onTTFB(reportWebVital);
      onINP(reportWebVital);
    }).catch(() => {});
  }, []);

  return null;
}
