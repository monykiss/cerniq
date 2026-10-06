import { describe, it, expect, vi } from 'vitest';
import { AgentApiError } from '../agents-api';

vi.mock('axios', async () => {
  const actual =
    await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
      }),
    },
  };
});

vi.mock('../api', () => ({
  getAccessToken: () => 'test-token',
  isAuthError: () => false,
  isPlatformAccessError: () => false,
}));

vi.mock('../api-base', () => ({
  getPublicApiBase: () => 'http://localhost:3000',
}));

describe('agents-api security', () => {
  it('AgentApiError has correct shape', () => {
    const err = new AgentApiError('test', 400, 'TEST', [
      { path: 'query', message: 'too long' },
    ]);
    expect(err.name).toBe('AgentApiError');
    expect(err.status).toBe(400);
    expect(err.code).toBe('TEST');
    expect(err.issues).toHaveLength(1);
    expect(err.message).toBe('test');
  });

  it('copilotQuery rejects empty query', async () => {
    const { copilotQuery } = await import('../agents-api');
    await expect(
      copilotQuery('inst-001', { query: '', language: 'en' }),
    ).rejects.toThrow('1–4000');
  });

  it('copilotQuery rejects oversized query', async () => {
    const { copilotQuery } = await import('../agents-api');
    const longQuery = 'x'.repeat(4001);
    await expect(
      copilotQuery('inst-001', { query: longQuery, language: 'en' }),
    ).rejects.toThrow('1–4000');
  });

  it('rejects institution ID with spaces', async () => {
    const { agentStreamUrl } = await import('../agents-api');
    expect(() => agentStreamUrl('inst-with spaces')).toThrow(
      'Invalid institution ID',
    );
  });

  it('rejects empty institution ID', async () => {
    const { agentStreamUrl } = await import('../agents-api');
    expect(() => agentStreamUrl('')).toThrow('Invalid institution ID');
  });

  it('rejects malicious institution ID (path traversal)', async () => {
    const { agentStreamUrl } = await import('../agents-api');
    expect(() => agentStreamUrl('../../etc/passwd')).toThrow(
      'Invalid institution ID',
    );
  });

  it('accepts valid UUID institution ID', async () => {
    const { agentStreamUrl } = await import('../agents-api');
    const url = agentStreamUrl('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(url).toContain('a1b2c3d4');
  });

  it('accepts safe alphanumeric institution ID', async () => {
    const { agentStreamUrl } = await import('../agents-api');
    const url = agentStreamUrl('fix-inst-001');
    expect(url).toContain('fix-inst-001');
  });
});
