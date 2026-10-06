import { NextResponse } from 'next/server';
import { getServices, saveServices, newId, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';
import type { Service } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Salon-owner: list services of HIS salon.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const services = (await getServices()).filter((s) => inSalon(s, salonId));
  return NextResponse.json({ services });
}

// Salon-owner: add a service to HIS salon.
export async function POST(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  const price = Number(body?.price);
  const durationMin = Number(body?.durationMin ?? 30);
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  if (!Number.isFinite(price) || price < 0 || price > 1000) return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
  if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 480) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });

  const service: Service = { id: newId(), name, price, durationMin, active: true, salonId };
  const services = await getServices();
  services.push(service);
  await saveServices(services);
  return NextResponse.json({ service }, { status: 201 });
}
