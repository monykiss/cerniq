import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutSession, getCurrentSubscription } from './billing';

describe('billing API routing', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts checkout through the same-origin billing endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.test/session' }),
    });

    const checkoutUrl = await createCheckoutSession({ tier: 'monthly' });

    expect(checkoutUrl).toBe('https://checkout.stripe.test/session');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/billing/checkout',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('supports checkout URLs nested under the backend data payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          checkoutUrl: 'https://checkout.stripe.test/nested-session',
        },
      }),
    });

    const checkoutUrl = await createCheckoutSession({ tier: 'one_time' });

    expect(checkoutUrl).toBe('https://checkout.stripe.test/nested-session');
  });

  it('loads subscriptions through the same-origin billing endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tier: 'annual', status: 'active' }),
    });

    await getCurrentSubscription();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/billing/subscription',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('unwraps subscriptions returned in the standard response envelope', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { tier: 'monthly', status: 'active' },
      }),
    });

    await expect(getCurrentSubscription()).resolves.toEqual({
      tier: 'monthly',
      status: 'active',
    });
  });
});
