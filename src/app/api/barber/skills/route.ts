import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import {
  getBarbers, listSkillVerifications, getSkillVerificationByBarberSkill,
  saveSkillVerification, savePhoto, newId,
} from '@/lib/store';
import type { SkillVerification } from '@/lib/types';

export const dynamic = 'force-dynamic';

function photoUrlOf(path: string): string {
  return `/api/photos/${encodeURIComponent(path.split('/').pop() || '')}`;
}

// GET /api/barber/skills → the barber's skills with verification status +
// collected photo URLs for each skill.
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const barbers = await getBarbers();
  const me = barbers.find((b) => b.id === session.barberId);
  if (!me) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const vers = await listSkillVerifications();
  const mine = new Map(vers.filter((v) => v.barberId === me.id).map((v) => [v.skill, v]));
  return NextResponse.json({
    skills: me.skills.map((skill) => {
      const v = mine.get(skill);
      return {
        name: skill,
        verified: (me.verifiedSkills ?? []).includes(skill),
        status: v?.status ?? 'none',
        photos: (v?.photoPaths ?? []).map(photoUrlOf),
      };
    }),
  });
}

// POST /api/barber/skills → add photos to a skill's collection (draft).
// Multipart: { skill, photos: File[] }. Max 10 photos per skill.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const barbers = await getBarbers();
  const me = barbers.find((b) => b.id === session.barberId);
  if (!me) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const skill = form?.get('skill');
  if (typeof skill !== 'string' || !me.skills.includes(skill)) {
    return NextResponse.json({ error: 'Unknown skill.' }, { status: 400 });
  }
  const files = form?.getAll('photos').filter((f): f is File => typeof f !== 'string') ?? [];
  if (!files.length) return NextResponse.json({ error: 'No photos provided.' }, { status: 400 });

  let v = await getSkillVerificationByBarberSkill(me.id, skill);
  if (v && v.status !== 'draft' && v.status !== 'rejected') {
    return NextResponse.json({ error: 'This skill is already submitted or verified.' }, { status: 409 });
  }
  if (!v) {
    v = {
      id: newId(),
      barberId: me.id,
      skill,
      photoPaths: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
      submittedAt: null,
      reviewedAt: null,
      salonId: await barberSalonId(session),
    } satisfies SkillVerification;
  }
  if (v.photoPaths.length + files.length > 10) {
    return NextResponse.json({ error: 'Max 10 photos per skill.' }, { status: 400 });
  }
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 5 * 1024 * 1024) continue;
    const ext = f.type.includes('png') ? 'png' : f.type.includes('webp') ? 'webp' : 'jpg';
    const path = await savePhoto(`skill-${v.id}-${Date.now()}.${ext}`, Buffer.from(await f.arrayBuffer()), f.type || 'image/jpeg');
    v.photoPaths.push(path);
  }
  v.status = 'draft';
  await saveSkillVerification(v);
  return NextResponse.json({ ok: true, photos: v.photoPaths.map(photoUrlOf) });
}
