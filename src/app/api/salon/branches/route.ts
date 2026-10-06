import { NextResponse } from 'next/server';
import { getBranches, saveBranches, newId, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import type { Branch } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Salon-owner: list branches of HIS salon.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const branches = (await getBranches()).filter((b) => inSalon(b, salonId));
  return NextResponse.json({ branches });
}

// Salon-owner: add a branch to HIS salon.
export async function POST(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  const address = String(body?.address || '').trim();
  const lat = Number(body?.lat ?? 0);
  const lng = Number(body?.lng ?? 0);
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  if (address.length < 3 || address.length > 200) return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: 'Invalid location' }, { status: 400 });

  const branch: Branch = { id: newId(), name, address, lat, lng, salonId };
  const branches = await getBranches();
  branches.push(branch);
  await saveBranches(branches);
  return NextResponse.json({ branch }, { status: 201 });
}
