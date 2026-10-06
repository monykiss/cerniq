import type { Metric } from 'web-vitals';

const ANALYTICS_ENDPOINT = '/api/analytics/web-vitals';

function shouldReportWebVitals() {
  if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined') {
    return false;
  }

  return !['localhost', '127.0.0.1'].includes(window.location.hostname);
}

/**
 * Reports Core Web Vitals (LCP, FID, CLS, FCP, TTFB) to backend.
 * Called from root layout via useReportWebVitals or manual onLoad.
 */
export function reportWebVital(metric: Metric) {
  if (!shouldReportWebVitals()) return;

  const body = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
    url: typeof window !== 'undefined' ? window.location.pathname : '',
    timestamp: new Date().toISOString(),
  };
  const payload = JSON.stringify(body);

  // Use sendBeacon for reliability (survives page unload)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      ANALYTICS_ENDPOINT,
      new Blob([payload], { type: 'application/json' })
    );
  } else {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}
