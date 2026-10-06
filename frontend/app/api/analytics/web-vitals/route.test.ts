import { describe, it, expect } from 'vitest';
import { GET, OPTIONS, POST } from './route';

describe('web vitals route', () => {
  it('accepts telemetry posts with a no-content response', async () => {
    const response = await POST(
      new Request('http://localhost/api/analytics/web-vitals', {
        method: 'POST',
        body: JSON.stringify({ name: 'LCP', value: 1234 }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(204);
  });

  it('supports simple health checks and preflight requests', async () => {
    expect((await GET()).status).toBe(204);
    expect((await OPTIONS()).status).toBe(204);
  });
});
