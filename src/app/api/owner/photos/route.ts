import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listWorkPhotos, getBarbers } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`;
}

// GET /api/owner/photos → pending work photos awaiting owner approval.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [all, barbers] = await Promise.all([listWorkPhotos(), getBarbers()]);
  const names = new Map(barbers.map((b) => [b.id, b.name]));
  const pending = all
    .filter((p) => p.status === 'pending')
    .map((p) => ({
      id: p.id,
      barberId: p.barberId,
      barberName: names.get(p.barberId) ?? 'Barber',
      url: photoUrlOf(p),
      createdAt: p.createdAt,
    }));
  return NextResponse.json({ photos: pending });
}
