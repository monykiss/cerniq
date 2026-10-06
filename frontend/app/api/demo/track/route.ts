import { NextResponse } from 'next/server';

type DemoTrackPayload = {
  step?: unknown;
  timestamp?: unknown;
};

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Demo analytics endpoint must never break demo UX or e2e tests.
 * This handler intentionally accepts malformed payloads and returns
 * a no-content response to keep tracking fire-and-forget.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DemoTrackPayload;

    // Parse lightweight fields for future observability hooks.
    const step = isFiniteNumber(body?.step) ? body.step : null;
    const timestamp = typeof body?.timestamp === 'string' ? body.timestamp : null;

    void step;
    void timestamp;
  } catch {
    // Swallow parse and runtime errors by design.
  }

  return new NextResponse(null, { status: 204 });
}
