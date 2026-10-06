import { test, expect } from '@playwright/test';

const API_BASE = (
  process.env.PLAYWRIGHT_BACKEND_URL ||
  process.env.NEXT_PUBLIC_NODE_API_URL ||
  'http://localhost:3000'
)
  .trim()
  .replace(/\/+$/, '');

function unwrapData<T>(body: T | { data: T }): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return body.data;
  }

  return body as T;
}

test.describe('API Health & Contracts', () => {
  test('backend health check responds with structured payload', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('success', true);
    const payload = unwrapData(body);
    // Health endpoint returns { status, timestamp, version, services }
    expect(payload).toHaveProperty('status');
    expect(payload).toHaveProperty('timestamp');
    expect(payload).toHaveProperty('version');
    expect(payload).toHaveProperty('services');
    expect(payload.services).toHaveProperty('api', 'up');
    // Local CI-like runs can surface `down` when optional dependencies are unavailable,
    // but the contract should still remain a structured, non-500 health response.
    expect(['ok', 'healthy', 'degraded', 'down']).toContain(payload.status);
  });

  test('API status endpoint returns service metadata', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('success', true);
    const payload = unwrapData(body);
    expect(payload).toHaveProperty('name', 'CERNIQ API');
    expect(payload).toHaveProperty('version');
    expect(payload).toHaveProperty('endpoints');
  });

  test('API returns standard error envelope for invalid routes', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/nonexistent-route-xyz`);
    expect(response.status()).toBe(404);
    const body = await response.json();
    // GlobalExceptionFilter returns { success: false, error: { code, message, timestamp, path } }
    expect(body).toHaveProperty('success', false);
    expect(body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(body.error).toHaveProperty('message');
    expect(body.error).toHaveProperty('timestamp');
    expect(body.error).toHaveProperty('path');
  });

  test('API returns 401 for unauthenticated ALM institution creation', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/alm/institutions`, {
      data: { name: 'Test', type: 'cooperativa' },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('API returns 401 for unauthenticated workspace requests', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/workspaces`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  test('API does not return 500 for paginated requests', async ({ request }) => {
    // Even unauthenticated, query params should be parsed without a server crash
    const response = await request.get(`${API_BASE}/api/alm/institutions?page=1&pageSize=10`);
    // Should return 401 (auth required), not 500 (server error)
    expect(response.status()).not.toBe(500);
  });

  test('demo-request endpoint rejects invalid payload', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/demo-request`, {
      data: {},
    });
    // Should return 400 (validation) or 422, not 500
    expect(response.status()).not.toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty('success', false);
  });
});
