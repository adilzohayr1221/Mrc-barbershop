import { NextResponse } from 'next/server';
import { requireActiveBarber } from '@/lib/guard';
import { getSkillVerificationByBarberSkill, saveSkillVerification } from '@/lib/store';

export const dynamic = 'force-dynamic';

// DELETE /api/barber/skills/photo — remove one photo from a draft/rejected
// skill collection. Body: { skill, photoUrl }.
export async function DELETE(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const { skill, photoUrl } = body ?? {};
  if (typeof skill !== 'string' || typeof photoUrl !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const v = await getSkillVerificationByBarberSkill(session.barberId, skill);
  if (!v || (v.status !== 'draft' && v.status !== 'rejected')) {
    return NextResponse.json({ error: 'Cannot remove photos now.' }, { status: 409 });
  }
  // Signed photo URLs (audit H7) carry a ?s= query — strip it before matching.
  const name = decodeURIComponent((photoUrl.split('/').pop() || '').split('?')[0]);
  const before = v.photoPaths.length;
  v.photoPaths = v.photoPaths.filter((p) => !p.endsWith(name));
  if (v.photoPaths.length === before) {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  }
  await saveSkillVerification(v);
  return NextResponse.json({ ok: true });
}
