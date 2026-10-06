import { NextResponse } from 'next/server';
import { getBranches, saveBranches, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Salon-owner: update one of HIS salon's branches.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const branches = await getBranches();
  const branch = branches.find((b) => b.id === id);
  if (!branch || !inSalon(branch, salonId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    branch.name = name;
  }
  if (body?.address !== undefined) {
    const address = String(body.address).trim();
    if (address.length < 3 || address.length > 200) return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    branch.address = address;
  }
  if (body?.lat !== undefined) {
    const lat = Number(body.lat);
    if (!Number.isFinite(lat)) return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    branch.lat = lat;
  }
  if (body?.lng !== undefined) {
    const lng = Number(body.lng);
    if (!Number.isFinite(lng)) return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    branch.lng = lng;
  }
  await saveBranches(branches);
  return NextResponse.json({ branch });
}

// Salon-owner: delete one of HIS salon's branches.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const { id } = await params;
  const branches = await getBranches();
  const idx = branches.findIndex((b) => b.id === id);
  if (idx < 0 || !inSalon(branches[idx], salonId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  branches.splice(idx, 1);
  await saveBranches(branches);
  return NextResponse.json({ ok: true });
}
