export async function POST(request: Request) {
  try {
    await request.text();
  } catch {
    // Ignore malformed payloads so telemetry never breaks the page.
  }

  return new Response(null, { status: 204 });
}

export function GET() {
  return new Response(null, { status: 204 });
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}
