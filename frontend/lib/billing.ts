import type { PortalSubscription } from './subscription';
import { getPublicApiUrl } from './api-base';
import { asRecord, unwrapApiData } from './api-response';
import { authFetch } from './auth-fetch';

export type CheckoutTier = 'one_time' | 'monthly' | 'annual' | 'partner';

interface CreateCheckoutSessionParams {
  tier: CheckoutTier;
  customerEmail?: string;
  customerName?: string;
  institutionName?: string;
  leadId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export async function createCheckoutSession({
  tier,
  customerEmail,
  customerName,
  institutionName,
  leadId,
  successUrl = '/login?billing=success&returnUrl=%2Fportal%3Fwelcome%3D1',
  cancelUrl = '/pricing',
}: CreateCheckoutSessionParams) {
  const response = await fetch(getPublicApiUrl('/api/billing/checkout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier,
      customerEmail,
      customerName,
      institutionName,
      leadId,
      successUrl,
      cancelUrl,
    }),
  });

  const data = await response.json().catch(() => ({}));
  const payload = asRecord(data);
  const normalizedPayload = asRecord(unwrapApiData<Record<string, unknown>>(data));
  const checkoutUrl =
    typeof payload?.checkoutUrl === 'string'
      ? payload.checkoutUrl
      : typeof payload?.url === 'string'
        ? payload.url
        : typeof normalizedPayload?.checkoutUrl === 'string'
          ? normalizedPayload.checkoutUrl
          : typeof normalizedPayload?.url === 'string'
            ? normalizedPayload.url
            : '';

  if (!response.ok || !checkoutUrl) {
    throw new Error(
      typeof payload?.message === 'string'
        ? payload.message
        : typeof normalizedPayload?.message === 'string'
          ? normalizedPayload.message
          : 'Unable to start checkout.',
    );
  }

  return checkoutUrl;
}

export async function getCurrentSubscription(): Promise<PortalSubscription> {
  const response = await authFetch(getPublicApiUrl('/api/billing/subscription'), {
    credentials: 'include',
  });

  const data = await response.json().catch(() => ({}));
  const payload = unwrapApiData<PortalSubscription>(data);
  if (!response.ok) {
    throw new Error(
      typeof asRecord(data)?.message === 'string'
        ? (asRecord(data)?.message as string)
        : 'Unable to load subscription.',
    );
  }

  return payload;
}
