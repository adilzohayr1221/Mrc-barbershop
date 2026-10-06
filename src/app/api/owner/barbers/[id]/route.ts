import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers, savePhoto, getBranches, getSalon } from '@/lib/store';
import { requireOwner } from '@/lib/auth';
import { PLATFORM_SALON_ID } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Owner-only: update a barber (name, skills, branches, photo, active, approved).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const contentType = req.headers.get('content-type') || '';
  let name: string | undefined, skills: string[] | undefined, branchIds: string[] | undefined;
  let approved: boolean | undefined;
  let salonId: string | undefined;
  let photoBuf: Buffer | null = null, photoType = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const n = form.get('name'); if (n !== null) name = String(n);
    const s = form.get('skills'); if (s !== null) { try { skills = JSON.parse(String(s)); } catch { /* keep */ } }
    const br = form.get('branchIds'); if (br !== null) { try { branchIds = JSON.parse(String(br)); } catch { /* keep */ } }
    const ap = form.get('approved'); if (ap !== null) approved = String(ap) === 'true';
    const sid = form.get('salonId'); if (sid !== null) salonId = String(sid);
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
    if (typeof body?.name === 'string') name = body.name;
    if (Array.isArray(body?.skills)) skills = body.skills.map(String);
    if (Array.isArray(body?.branchIds)) branchIds = body.branchIds.map(String);
    if (typeof body?.approved === 'boolean') approved = body.approved;
    if (typeof body?.salonId === 'string') salonId = body.salonId;
  }

  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === id);
  if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (approved !== undefined) barber.approved = approved;

  // Salon assignment (platform owner picks the salon when approving a barber).
  if (salonId !== undefined) {
    if (salonId !== PLATFORM_SALON_ID) {
      const salon = await getSalon(salonId);
      if (!salon || salon.status !== 'active') {
        return NextResponse.json({ error: 'Unknown or inactive salon.' }, { status: 400 });
      }
    }
    barber.salonId = salonId;
  }

  if (name !== undefined) {
    if (name.trim().length < 2 || name.trim().length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    barber.name = name.trim();
  }
  if (skills !== undefined) barber.skills = skills.map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (branchIds !== undefined) {
    const branches = await getBranches();
    const valid = branchIds.filter((bid) => branches.some((b) => b.id === bid));
    if (!valid.length) return NextResponse.json({ error: 'Select at least one branch' }, { status: 400 });
    barber.branchIds = valid;
  }
  if (photoBuf) {
    const ext = photoType.includes('png') ? 'png' : photoType.includes('webp') ? 'webp' : 'jpg';
    barber.photoPath = await savePhoto(`${id}.${ext}`, photoBuf, photoType);
  }
  await saveBarbers(barbers);
  return NextResponse.json({ barber });
}

// Owner-only: soft-delete a barber (hidden from booking/login; records kept).
// The barber's email login is wiped so the same email can register again later.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === id);
  if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  barber.active = false;
  barber.email = undefined;
  barber.passwordHash = undefined;
  barber.approved = false;
  await saveBarbers(barbers);
  return NextResponse.json({ ok: true });
}
