import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  const html = await readFile(
    join(process.cwd(), 'public', 'demo-video', 'index.html'),
    'utf-8',
  );

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
