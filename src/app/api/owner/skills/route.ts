import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listSkillVerifications, getBarbers } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(path: string): string {
  return `/api/photos/${encodeURIComponent(path.split('/').pop() || '')}`;
}

// GET /api/owner/skills — all skill verification batches with barber names.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [vers, barbers] = await Promise.all([listSkillVerifications(), getBarbers()]);
  const nameOf = new Map(barbers.map((b) => [b.id, b.name]));
  return NextResponse.json({
    verifications: vers.map((v) => ({
      id: v.id,
      barberId: v.barberId,
      barberName: nameOf.get(v.barberId) ?? 'Barber',
      skill: v.skill,
      photos: v.photoPaths.map(photoUrlOf),
      status: v.status,
      createdAt: v.createdAt,
      submittedAt: v.submittedAt ?? null,
    })),
  });
}
