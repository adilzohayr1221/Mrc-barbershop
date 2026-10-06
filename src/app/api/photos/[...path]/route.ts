import { NextResponse } from 'next/server';
import { getPhoto } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Public: serves barber photos. Only files under photos/ are reachable.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const name = (path || []).join('/');
  if (!name || name.includes('..') || name.length > 120) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const file = await getPhoto(name);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(file.data, {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
