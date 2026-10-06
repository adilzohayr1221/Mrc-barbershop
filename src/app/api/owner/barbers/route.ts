import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers, savePhoto, getBranches, newId } from '@/lib/store';
import { requireOwner } from '@/lib/auth';
import type { Barber } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Owner-only: list barbers (includes inactive; never includes PINs or password hashes).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const barbers = await getBarbers();
  return NextResponse.json({
    barbers: barbers.map((b) => {
      const { passwordHash: _ph, ...safe } = b;
      return {
        ...safe,
        photoUrl: b.photoPath ? `/api/photos/${encodeURIComponent(b.photoPath.split('/').pop() || '')}` : null,
      };
    }),
  });
}

// Owner-only: add a barber. Accepts JSON or multipart (photo).
export async function POST(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const contentType = req.headers.get('content-type') || '';
  let name = '', skills: string[] = [], branchIds: string[] = [], photoBuf: Buffer | null = null, photoType = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '');
    try { skills = JSON.parse(String(form.get('skills') || '[]')); } catch { skills = []; }
    try { branchIds = JSON.parse(String(form.get('branchIds') || '[]')); } catch { branchIds = []; }
    const photo = form.get('photo');
    if (photo && typeof photo !== 'string') {
      const ab = await photo.arrayBuffer();
      if (ab.byteLength > 0 && ab.byteLength <= 5 * 1024 * 1024) {
        photoBuf = Buffer.from(ab);
        photoType = photo.type || 'image/jpeg';
      }
    }
  } else {
    const body = await req.json().catch(() => null);
    name = String(body?.name || '');
    skills = Array.isArray(body?.skills) ? body.skills.map(String) : [];
    branchIds = Array.isArray(body?.branchIds) ? body.branchIds.map(String) : [];
  }

  if (name.trim().length < 2 || name.trim().length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  const branches = await getBranches();
  const validBranchIds = branchIds.filter((id) => branches.some((b) => b.id === id));
  if (!validBranchIds.length) return NextResponse.json({ error: 'Select at least one branch' }, { status: 400 });

  const id = newId();
  let photoPath: string | null = null;
  if (photoBuf) {
    const ext = photoType.includes('png') ? 'png' : photoType.includes('webp') ? 'webp' : 'jpg';
    photoPath = await savePhoto(`${id}.${ext}`, photoBuf, photoType);
  }
  const barber: Barber = {
    id,
    name: name.trim(),
    photoPath,
    skills: skills.map((s) => s.trim()).filter(Boolean).slice(0, 20),
    branchIds: validBranchIds,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const barbers = await getBarbers();
  barbers.push(barber);
  await saveBarbers(barbers);
  return NextResponse.json({ barber }, { status: 201 });
}
