import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers, getBranches, newId, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import type { Barber } from '@/lib/types';

export const dynamic = 'force-dynamic';

function safeBarber(b: Barber) {
  const { passwordHash: _ph, ...rest } = b;
  return {
    ...rest,
    photoUrl: b.photoPath ? `/api/photos/${encodeURIComponent(b.photoPath.split('/').pop() || '')}` : null,
  };
}

// Salon-owner: list barbers of HIS salon (includes inactive — they carry the
// active flag). Never includes password hashes.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const barbers = (await getBarbers()).filter((b) => inSalon(b, salonId));
  return NextResponse.json({ barbers: barbers.map(safeBarber) });
}

// Salon-owner: add a barber to HIS salon. The barber sets his own password
// later via the existing barber-signup flow — here only name (+ optional
// email/skills/branches) is stored.
export async function POST(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const emailRaw = String(body?.email ?? '').trim().toLowerCase();
  const skills = Array.isArray(body?.skills) ? body.skills.map(String).map((s: string) => s.trim()).filter(Boolean).slice(0, 20) : [];
  const branchIds = Array.isArray(body?.branchIds) ? body.branchIds.map(String) : [];

  if (name.length < 2 || name.length > 60) {
    return NextResponse.json({ error: 'Enter a valid name (2–60 characters).' }, { status: 400 });
  }
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  // Every branch must belong to this salon.
  const myBranchIds = new Set(
    (await getBranches()).filter((b) => inSalon(b, salonId)).map((b) => b.id)
  );
  for (const id of branchIds) {
    if (!myBranchIds.has(id)) {
      return NextResponse.json({ error: 'Unknown branch.' }, { status: 400 });
    }
  }

  const barbers = await getBarbers();
  if (emailRaw && barbers.some((b) => b.active && b.email && b.email.toLowerCase() === emailRaw)) {
    return NextResponse.json(
      { error: 'An account with this email already exists. Try logging in instead.' },
      { status: 409 }
    );
  }

  const barber: Barber = {
    id: newId(),
    name,
    email: emailRaw || undefined,
    approved: true,
    active: true,
    skills,
    branchIds,
    photoPath: null,
    createdAt: new Date().toISOString(),
    salonId,
  };
  barbers.push(barber);
  await saveBarbers(barbers);
  return NextResponse.json({ barber: safeBarber(barber) }, { status: 201 });
}
