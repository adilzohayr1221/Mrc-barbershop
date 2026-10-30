import { NextResponse } from 'next/server';
import { getBarbers, saveBarbers } from '@/lib/store';
import { requireActiveBarber } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Barber-only: read his own VIP home-visit opt-in.
export async function GET(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId);
  return NextResponse.json({ houseCalls: barber?.houseCalls === true });
}

// Barber-only: turn VIP home visits on/off for himself. A home visit is a
// flat $100 paid in full at booking; the barber's payout share is $60.
export async function PUT(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId && b.active);
  if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  barber.houseCalls = body.enabled;
  await saveBarbers(barbers);
  return NextResponse.json({ ok: true, houseCalls: barber.houseCalls });
}
