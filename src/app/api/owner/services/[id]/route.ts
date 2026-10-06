import { NextResponse } from 'next/server';
import { getServices, saveServices } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: update a service.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const services = await getServices();
  const service = services.find((s) => s.id === id);
  if (!service) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    service.name = name;
  }
  if (body?.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 1000) return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
    service.price = price;
  }
  if (body?.durationMin !== undefined) {
    const d = Number(body.durationMin);
    if (!Number.isInteger(d) || d < 5 || d > 480) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
    service.durationMin = d;
  }
  if (body?.active !== undefined) service.active = !!body.active;
  await saveServices(services);
  return NextResponse.json({ service });
}

// Owner-only: delete a service.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const services = await getServices();
  const idx = services.findIndex((s) => s.id === id);
  if (idx < 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  services.splice(idx, 1);
  await saveServices(services);
  return NextResponse.json({ ok: true });
}
