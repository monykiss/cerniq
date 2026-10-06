import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/demo/track/route';

describe('POST /api/demo/track', () => {
  it('returns 204 for valid payloads', async () => {
    const request = new Request('http://localhost/api/demo/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 3, timestamp: '2026-04-24T00:00:00.000Z' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });

  it('returns 204 for malformed json payloads', async () => {
    const request = new Request('http://localhost/api/demo/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });

  it('returns 204 for unexpected payload shapes', async () => {
    const request = new Request('http://localhost/api/demo/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'oops', timestamp: 123 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });
});
