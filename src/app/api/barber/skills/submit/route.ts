import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getBarbers, getSkillVerificationByBarberSkill, saveSkillVerification } from '@/lib/store';

export const dynamic = 'force-dynamic';

const MIN_PHOTOS = 3;

// POST /api/barber/skills/submit — send a skill's photo collection to the
// owner as one batch for verification. Needs at least 3 photos.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const skill = body?.skill;
  if (typeof skill !== 'string' || !skill) {
    return NextResponse.json({ error: 'Unknown skill.' }, { status: 400 });
  }
  const barbers = await getBarbers();
  const me = barbers.find((b) => b.id === session.barberId);
  if (!me || !me.skills.includes(skill)) {
    return NextResponse.json({ error: 'Unknown skill.' }, { status: 400 });
  }
  const v = await getSkillVerificationByBarberSkill(me.id, skill);
  if (!v || (v.status !== 'draft' && v.status !== 'rejected')) {
    return NextResponse.json({ error: 'Nothing to submit.' }, { status: 409 });
  }
  if (v.photoPaths.length < MIN_PHOTOS) {
    return NextResponse.json(
      { error: `Collect at least ${MIN_PHOTOS} photos for "${skill}" first.` },
      { status: 400 }
    );
  }
  v.status = 'pending';
  v.submittedAt = new Date().toISOString();
  v.reviewedAt = null;
  await saveSkillVerification(v);
  return NextResponse.json({ ok: true });
}
